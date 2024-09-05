import type { ErrorRequestHandler, RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

const unexpectedRequest: RequestHandler = (_req, res) => {
  res.status(StatusCodes.NOT_FOUND).json({
    error: "Not Found",
    message: "The requested resource could not be found.",
  });
};

const addErrorToRequestLog: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error("Error:", err);

  const statusCode = err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR;
  const message = err.message || "An unexpected error occurred";

  res.status(statusCode).json({
    error: StatusCodes[statusCode],
    message: message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
};

export default () => [unexpectedRequest, addErrorToRequestLog];
