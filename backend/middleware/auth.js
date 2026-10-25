import jwt from "jsonwebtoken";
import { getUserByEmail } from "../services/db.js";
import { getJwtSecret } from "../services/jwtSecret.js";

export async function verifyToken(request, response, next) {
  const authorization = request.get("authorization") ?? "";
  const [scheme, token] = authorization.split(/\s+/);

  if (scheme !== "Bearer" || !token) {
    response.status(401).json({ error: "A Bearer token is required." });
    return;
  }

  let secret;
  try {
    secret = await getJwtSecret();
  } catch (error) {
    next(error);
    return;
  }

  let claims;
  try {
    claims = jwt.verify(token, secret, { issuer: "civicguard" });
  } catch {
    response.status(401).json({ error: "The authentication token is invalid or expired." });
    return;
  }

  if (
    typeof claims !== "object" ||
    typeof claims.sub !== "string" ||
    typeof claims.email !== "string" ||
    !["citizen", "authority"].includes(claims.role)
  ) {
    response.status(401).json({ error: "The authentication token is invalid." });
    return;
  }

  try {
    const user = await getUserByEmail(claims.email);
    if (
      !user ||
      !user.emailVerified ||
      user.id !== claims.sub ||
      user.role !== claims.role
    ) {
      response.status(401).json({ error: "This account is not verified or is no longer active." });
      return;
    }

    request.user = { id: user.id, email: user.email, role: user.role };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuthority(request, response, next) {
  if (request.user?.role !== "authority") {
    response.status(403).json({ error: "Authority access is required for this action." });
    return;
  }

  next();
}
