// import http from 'http';
// import express from 'express';
// import { Server } from 'socket.io';
// import cors from "cors";
// import dotenv from "dotenv";
// import { PrismaClient } from '@prisma/client';

// // Fetching the Configurations from the Env File.
// dotenv.config();

// // Creating a express server so that we can handle the HTTP routes:
// const app = express();

// // Creating a raw http server to be used later by the socket.io
// const server = http.createServer(app);

// // Creating a websocket server.
// const io = new Server(server, {
//     cors: { origin: "*"}
// });

// // Initialize Prisma Client
// const prisma = new PrismaClient();

// // Using cors for CORS related issues.
// app.use(cors());
// app.use(express.json());

// app.use('/auth', authRoute);

// app.get('/', (_, res) => {
//     res.send("Chat app backend running!");
// });

// io.on('connection', socket => {
//     console.log(`User connected: ${socket.id}`);
//     socket.on("disconnect", ()=> console.log(`User discconnected: ${socket.id}`));
// });

// const PORT = process.env.PORT || 4000;
// server.listen(PORT, () => {
//     console.log(`Server running on port: ${PORT}`);
// });

// export { app, server }


import http from 'http';
import { createApp } from './app';
import logger from './lib/logger';
import { initSocket } from './index';

const app = createApp();
const server = http.createServer(app);
const io = initSocket(server);

export { server };

const PORT = Number(process.env.PORT ?? 4000);

export async function startServer(PORT: number = Number(process.env.PORT ?? 4000)) {
  return new Promise<void>((resolve) => {
    server.listen(PORT, () => {
      logger.info(`Server listening on PORT: ${PORT}`);
      resolve();
    });
  });
}

export async function stopServer() {
  logger.info("Shutting Down");

  // Stop socket.io
  await io.close(); 

  // Stop HTTP server
  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

async function main() {
  await startServer();

  const shutdown = async () => {
    await stopServer();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

try {
    main();
} catch (error) {
    console.log(`Error comming from Server: ${error}`);
    process.exit(1);
}