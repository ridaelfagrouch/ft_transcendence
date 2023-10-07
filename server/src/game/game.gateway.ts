import {
  WebSocketGateway,
  SubscribeMessage,
  WebSocketServer,
  ConnectedSocket,
} from '@nestjs/websockets';
import { GameService } from './game.service';
import { Server, Socket } from 'socket.io';
import { Body } from '@nestjs/common';
import { GameModalState } from './dto/create-game.dto';

@WebSocketGateway()
export class GameGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly gameService: GameService) {}

  private interval: NodeJS.Timeout | null = null;
  private isPaused = false;
  private count = 0;
  private readonly connectedUsers: { [userId: string]: Socket } = {};

  // handelConnection(client: Socket): void {
  //   console.log('client connected', client);
  // }

  // ---------------- sendGameData

  @SubscribeMessage('sendGameData')
  sendGameData(@Body() data): void {
    try {
      this.gameService.initGameData(data.initCanvasData, data.roomId);
      this.interval = setInterval(() => {
        const getRoom = this.gameService.getRoom(data.roomId);
        if (!getRoom?.isPoused) {
          this.gameService.updateBallPosition(data.roomId);
          this.server
            .to(data.roomId)
            .emit('GetGameData', this.gameService.getUpdateData(data.roomId));
        }
      }, 15);
    } catch (error) {
      console.error('Error in sendGameData:', error);
    }
  }

  // ---------------- updatePaddles

  @SubscribeMessage('updatePaddles')
  updatePaddles(@Body() data): void {
    try {
      this.gameService.updatePaddles(data.canvasData, data.roomId);
    } catch (error) {
      console.error('Error in updatePaddles:', error);
    }
  }

  // ---------------- endGame

  @SubscribeMessage('endGame')
  endGame(@ConnectedSocket() client: Socket, @Body() roomId: string): void {
    try {
      console.log('-----------------endGame-----------------');
      this.gameService.setRoomPause(roomId, true);
      this.gameService.deleteRoom(roomId);
      clearInterval(this.interval as NodeJS.Timeout);
      this.server.in(roomId).socketsLeave(roomId);
    } catch (error) {
      console.error('Error in endGame:', error);
    }
  }

  // ---------------- pauseGame

  @SubscribeMessage('pauseGame')
  pauseGame(@Body() roomId: string): void {
    // console.log('-----------------pauseGame-----------------');
    // console.log('pauseGame roomId', roomId);
    // console.log('pauseGame all rooms: ', this.gameService.getAllRooms());
    this.gameService.setRoomPause(roomId, true);
  }

  // ---------------- resumeGame

  @SubscribeMessage('resumeGame')
  resumeGame(@Body() roomId: string): void {
    this.gameService.setRoomPause(roomId, false);
  }

  // ---------------- createRoomNotifacaion

  @SubscribeMessage('createRoomNotification')
  createRoomNotifacation(
    @ConnectedSocket() client: Socket,
    @Body() data: { userId: string },
  ): string {
    try {
      console.log('-----------------createRoomNotifacation-----------------');
      const userId = data.userId;
      client.join(userId);
      this.connectedUsers[userId] = client;
      return 'your Notification room is ready';
    } catch (error) {
      console.error('Error in createRoomNotifacation:', error);
    }
  }

  // ---------------- createRoom
  //async
  @SubscribeMessage('createRoom')
  createRoom(@ConnectedSocket() client: Socket): string {
    try {
      console.log('-----------------createRoom-----------------');
      const clientUserId = client.id;
      const roomId = this.gameService.createRoom(clientUserId);
      client.join(roomId);
      // console.log('createRoom all rooms: ', this.gameService.getAllRooms());
      // console.log(
      //   'createRoom get one room : ',
      //   this.gameService.getRoom(roomId),
      // );
      return roomId;
    } catch (error) {
      console.error('Error in createRoom:', error);
      return 'error';
    }
  }

  // ---------------- inviteFriend

  @SubscribeMessage('inviteFriend')
  async inviteFriend(
    @ConnectedSocket() client: Socket,
    @Body()
    data: { roomId: string; friendId: string; modalData: GameModalState },
  ): Promise<void> {
    try {
      console.log('-----------------inviteFriend-----------------');
      const clientUserId = client.id;
      const roomId = data.roomId;
      const friendUserId = data.friendId;
      const room = this.server.sockets.adapter.rooms.get(roomId);
      const modalData = data.modalData;

      if (this.gameService.isRoomOwner(clientUserId, roomId)) {
        if (room && room.size < 2) {
          const friendSocket = this.connectedUsers[friendUserId];
          if (friendSocket) {
            this.server
              .to(friendUserId)
              .emit('room-invitation', { roomId, modalData });
          }
        } else {
          console.error('Room is full. Cannot invite more players.');
        }
      } else {
        console.error('Client is not the owner of the room.');
      }
    } catch (error) {
      console.error('Error in inviteFriend:', error);
    }
  }

  //-------------acceptInvitation
  @SubscribeMessage('acceptInvitation')
  acceptInvitation(
    @ConnectedSocket() client: Socket,
    @Body() data: { roomId: string },
  ): void {
    try {
      console.log('-----------------acceptInvitation-----------------');
      // console.log('roomId', data.roomId);
      const roomId = data.roomId;
      const room = this.server.sockets.adapter.rooms.get(roomId);
      // console.log('room', room);
      if (room && room.size < 2) {
        client.join(roomId);
        this.gameService.addPlayerToRoom(roomId, client.id);
        this.server.to(roomId).emit('playGame');
      } else if (room && room.size >= 2) {
        console.error('Room is full. Cannot invite more players.');
      } else {
        console.error('Room is not exist.');
      }
    } catch (error) {
      console.error('Error in acceptInvitation:', error);
    }
  }

  //-------------denyInvitation
  // @SubscribeMessage('denyInvitation')
  // denyInvitation(
  //   @ConnectedSocket() client: Socket,
  //   @Body() data: { roomId: string },
  // ): void {
  //   try {
  //   } catch (error) {
  //     console.error('Error in denyInvitation:', error);
  //   }
  // }

  @SubscribeMessage('leaveRoom')
  leaveRoom(@ConnectedSocket() client: Socket, @Body() roomId: string): void {
    try {
      client.leave(roomId);
      this.gameService.deleteRoom(roomId);
    } catch (error) {
      console.error('Error in leaveRoom:', error);
    }
  }
}
