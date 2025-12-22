import winston from 'winston';

const getAllowedLevels = () => {
  const envVal = process.env.LOG_LEVEL || "info";

  return envVal
    .split(",")
    .map((level) => level.trim().toLowerCase());
};

const levelFilter = winston.format((info) => {
  const allowed = getAllowedLevels();

  // If the log level is allowed --> keep it
  if (allowed.includes(info.level)) {
    return info;
  }

  // Otherwise filter it out
  return false;
});

const logger = winston.createLogger({
    level: "silly",
    format  : winston.format.combine(
        levelFilter(),
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, reqId ,...meta }) => {
            const metaString = Object.keys(meta).length ? JSON.stringify(meta) : '';
            return `${timestamp} [${level.toUpperCase()}] [${reqId ?? 'no-req-id'}] ${message} ${metaString}`;
        })
    ),
    transports  : [new winston.transports.Console()]
});

export default logger;