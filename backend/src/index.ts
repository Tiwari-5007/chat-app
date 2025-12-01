import { Server, Socket } from 'socket.io';
import { Server as HTTPServer} from 'http';
import logger from './lib/logger';

export function initSocket(server: HTTPServer) {

    const io = new Server(server, {
        cors: { origin: true },
        path: '/socket'
    });

    io.on('connection', (socket: Socket) => {
        logger.info(`User connected: ${socket.id}`);

        // Logging the event when the socket is being disconnected.
        socket.on('disconnect', () => {
            logger.info(`User Disconnectd: ${socket.id}`);
        });
    });

    return io;
}