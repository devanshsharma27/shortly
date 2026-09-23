import express from "express";
import { randomBytes, randomInt, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Redis from "ioredis";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || "http://localhost:8080").replace(
  /\/$/,
  "",
);
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const alphabet =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const shortCode = () =>
  Array.from({ length: 7 }, () => alphabet[randomInt(62)]).join("");
function validUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || !/^https?:\/\//i.test(value) || /[\r\n\t]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
// Only enable behind our Nginx; backend ports must remain private.
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
app.disable("x-powered-by");
const prisma = new PrismaClient();

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  connectTimeout: 1000,
});
redis.on("error", () => {});
const CACHE_TTL_SECONDS = 60;

const JWT_SECRET: string = process.env.JWT_SECRET ?? "";
if (JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters");
}

const REFRESH_TOKEN_DAYS = 7;

// ================= LOGGING MIDDLEWARE (runs first) =================

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`,
    );
  });
  next();
});

app.use(express.json({ limit: "16kb" }));
app.use((req, res, next) => {
  req.body ??= {};
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

// Interactive API docs
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ================= ASYNC ERROR WRAPPER =================

function asyncHandler(
  fn: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => Promise<unknown>,
) {
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    fn(req, res, next).catch(next);
  };
}

// ================= RATE LIMIT MIDDLEWARE (factory) =================

function rateLimit(name: string, maxRequests: number, windowSeconds: number) {
  return async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const ip = req.ip ?? "unknown";
      const key = `ratelimit:${name}:${ip}`;

      const count = Number(
        await redis.eval(
          "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n",
          1,
          key,
          windowSeconds,
        ),
      );

      if (count > maxRequests) {
        res.setHeader("Retry-After", windowSeconds);
        return res.status(429).json({ error: "too many requests, slow down" });
      }

      next();
    } catch {
      if (name === "login")
        return res
          .status(503)
          .json({
            error: "Sign-in temporarily unavailable. Try again shortly.",
          });
      next(); // Availability over strict limits for links when Redis is unavailable.
    }
  };
}

const loginLimiter = rateLimit("login", 5, 60);
const apiLimiter = rateLimit("api", 100, 60);
const redirectLimiter = rateLimit("redirect", 300, 60);

// ================= AUTH MIDDLEWARE =================

interface AuthRequest extends express.Request {
  userId?: number;
}

function requireAuth(
  req: AuthRequest,
  res: express.Response,
  next: express.NextFunction,
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing or malformed token" });
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    }) as { userId: number };
    if (!Number.isSafeInteger(payload.userId) || payload.userId <= 0)
      throw new Error("Invalid subject");
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "invalid or expired token" });
  }
}

async function issueTokens(
  userId: number,
  db: Pick<PrismaClient, "refreshToken"> = prisma,
) {
  const accessToken = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "15m" });

  const refreshToken = randomBytes(48).toString("hex");
  const expiresAt = new Date(
    Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
  );

  await db.refreshToken.create({
    data: { token: tokenHash(refreshToken), userId, expiresAt },
  });

  return { accessToken, refreshToken };
}

// ================= HEALTH =================

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", instance: process.env.INSTANCE_NAME || "local" });
});

app.get(
  "/api/ready",
  asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    let cache = "available";
    try {
      await redis.ping();
    } catch {
      cache = "unavailable";
    }
    res.json({ status: "ready", cache });
  }),
);

// ================= AUTH ROUTES =================

app.post(
  "/api/auth/register",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { password } = req.body;
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      typeof password !== "string" ||
      !password ||
      Buffer.byteLength(password) > 72
    ) {
      return res.status(400).json({ error: "email and password are required" });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "password must be at least 8 characters" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, password: hashedPassword },
    });

    res.status(201).json({ id: user.id, email: user.email });
  }),
);

app.post(
  "/api/auth/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { password } = req.body;
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      typeof password !== "string" ||
      !password ||
      Buffer.byteLength(password) > 72
    ) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "invalid credentials" });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ error: "invalid credentials" });
    }

    const tokens = await issueTokens(user.id);

    res.json(tokens);
  }),
);

app.post(
  "/api/auth/refresh",
  apiLimiter,
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    if (
      typeof refreshToken !== "string" ||
      !refreshToken ||
      refreshToken.length > 256
    ) {
      return res.status(400).json({ error: "refreshToken is required" });
    }

    const tokens = await prisma.$transaction(async (tx) => {
      const stored = await tx.refreshToken.findUnique({
        where: { token: tokenHash(refreshToken) },
      });
      if (!stored || stored.expiresAt <= new Date()) return null;
      // Conditional delete makes concurrent refreshes single-use across instances.
      const deleted = await tx.refreshToken.deleteMany({
        where: { id: stored.id },
      });
      if (deleted.count !== 1) return null;
      return issueTokens(stored.userId, tx);
    });
    if (!tokens)
      return res
        .status(401)
        .json({ error: "invalid or expired refresh token" });

    res.json(tokens);
  }),
);

app.post(
  "/api/auth/logout",
  apiLimiter,
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    if (
      typeof refreshToken !== "string" ||
      !refreshToken ||
      refreshToken.length > 256
    ) {
      return res.status(400).json({ error: "refreshToken is required" });
    }

    await prisma.refreshToken.deleteMany({
      where: { token: tokenHash(refreshToken) },
    });

    res.status(204).send();
  }),
);

// ================= URL ROUTES =================

app.get(
  "/api/urls",
  apiLimiter,
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const page = Math.min(
      1000000,
      Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1),
    );
    const limit = Math.min(
      50,
      Math.max(1, parseInt(String(req.query.limit ?? "10"), 10) || 10),
    );
    const search = String(req.query.search ?? "").slice(0, 2048);

    const where = {
      userId: req.userId,
      ...(search && {
        longUrl: { contains: search, mode: "insensitive" as const },
      }),
    };

    const [urls, total] = await Promise.all([
      prisma.url.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.url.count({ where }),
    ]);

    res.json({
      data: urls.map((url) => ({
        ...url,
        shortUrl: `${BASE_URL}/${url.shortCode}`,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }),
);

app.post(
  "/api/urls",
  apiLimiter,
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const { longUrl } = req.body;

    if (!validUrl(longUrl)) {
      return res
        .status(400)
        .json({
          error:
            "Enter a valid http:// or https:// URL (maximum 2048 characters)",
        });
    }

    let record;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        record = await prisma.url.create({
          data: { shortCode: shortCode(), longUrl, userId: req.userId },
        });
        break;
      } catch (err: any) {
        if (err.code !== "P2002") throw err;
      }
    }
    if (!record)
      return res
        .status(503)
        .json({ error: "Could not allocate a link. Try again." });

    res.status(201).json({
      ...record,
      shortUrl: `${BASE_URL}/${record.shortCode}`,
    });
  }),
);

app.delete(
  "/api/urls/:id",
  apiLimiter,
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: "invalid id" });
    }

    const record = await prisma.url.findUnique({ where: { id } });

    if (!record) {
      return res.status(404).json({ error: "URL not found" });
    }

    if (record.userId !== req.userId) {
      return res.status(403).json({ error: "you do not own this URL" });
    }

    await prisma.url.delete({ where: { id } });

    await redis.del(`url:${record.shortCode}`).catch(() => {});

    res.status(204).send();
  }),
);

app.patch(
  "/api/urls/:id",
  apiLimiter,
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const { longUrl } = req.body;

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: "invalid id" });
    }
    if (!validUrl(longUrl)) {
      return res
        .status(400)
        .json({
          error:
            "Enter a valid http:// or https:// URL (maximum 2048 characters)",
        });
    }

    const record = await prisma.url.findUnique({ where: { id } });

    if (!record) {
      return res.status(404).json({ error: "URL not found" });
    }

    if (record.userId !== req.userId) {
      return res.status(403).json({ error: "you do not own this URL" });
    }

    const updated = await prisma.url.update({
      where: { id },
      data: { longUrl },
    });

    await redis.del(`url:${record.shortCode}`).catch(() => {});

    res.json({ ...updated, shortUrl: `${BASE_URL}/${updated.shortCode}` });
  }),
);

// Redirect — cached, rate-limited
app.get(
  "/:code",
  redirectLimiter,
  asyncHandler(async (req, res) => {
    const code = String(req.params.code);
    const cacheKey = `url:${code}`;

    res.setHeader("Cache-Control", "no-store");
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      prisma.url
        .update({
          where: { shortCode: code },
          data: { clicks: { increment: 1 } },
        })
        .catch(() => {});
      return res.redirect(302, cached);
    }

    const record = await prisma.url.findUnique({
      where: { shortCode: code },
    });

    if (!record) {
      return res.status(404).json({ error: "Short URL not found" });
    }

    await redis
      .set(cacheKey, record.longUrl, "EX", CACHE_TTL_SECONDS)
      .catch(() => {});

    prisma.url
      .update({
        where: { shortCode: code },
        data: { clicks: { increment: 1 } },
      })
      .catch(() => {});

    res.redirect(302, record.longUrl);
  }),
);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ================= GLOBAL ERROR HANDLER (registered LAST) =================

app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (err?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "invalid JSON in request body" });
    }

    if (err?.code === "P2002")
      return res.status(409).json({ error: "Already exists" });
    if (err?.code === "P2025")
      return res.status(404).json({ error: "Not found" });
    if (err?.type === "entity.too.large")
      return res.status(413).json({ error: "Request too large" });
    console.error(
      `${new Date().toISOString()} ERROR ${req.method} ${req.originalUrl}:`,
      err,
    );
    res.status(500).json({ error: "internal server error" });
  },
);

const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
process.on("SIGTERM", () => {
  server.close(async () => {
    redis.disconnect();
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
});
