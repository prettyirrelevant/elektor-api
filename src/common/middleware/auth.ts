import type { NextFunction, Request, Response } from "express";

import { validateSignature } from "@/helpers";

const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Authentication failed",
      });
    }

    const token = authHeader.slice(7).trim();
    const [walletAddress, signature] = token.split(":");
    if (!walletAddress || !signature) {
      return res.status(401).json({ message: "Authentication failed" });
    }

    const isValid = validateSignature(signature, walletAddress);
    if (!isValid) {
      return res.status(401).json({ message: "Authentication failed" });
    }

    req.address = walletAddress;

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export default authMiddleware;
