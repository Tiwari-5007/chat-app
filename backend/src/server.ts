import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

// Creating a express server so that we can handle the HTTP routes:
const app = express();

// Creating a raw http server to be used later by the socket.io
const server = http.createServer(app);

// Creating a websocket server.
const io = new Server(server, {
    cors: { origin: "*"}
});

// Using cors for CORS related issues.
app.use(cors());
app.use(express.json());

app.get('/', (_, res) => {
    res.send("Chat app backend running!");
});

io.on('connection', socket => {
    console.log(`User connected: ${socket.id}`);
    socket.on("disconnect", ()=> console.log(`User discconnected: ${socket.id}`));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`Server running on port: ${PORT}`);
});

export { app, server }