import { MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, OnGatewayConnection, WebSocketServer, ConnectedSocket } from '@nestjs/websockets';
import { Body, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { UsersService } from './users/users.service';
import { MessageService } from './message/message.service'
import { Prisma } from '@prisma/client';
import { ChannelService } from './channel/channel.service';





@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  constructor(
    private messageService: MessageService,
    private channelService: ChannelService,
    private userService: UsersService,
  ) { }

  @WebSocketServer()
  server: Server;

  private readonly connectedUsers: { [userId: string]: Socket[] } = {};
  private logger: Logger = new Logger(`ChatGateway`);

  afterInit() {
    this.logger.log(`Initialized`);
  }
  //!---------------CONNECTION------------------------!//

  async handleConnection(client: Socket) {

    this.connectedUsers[client.handshake.auth.id] = [
      ...(this.connectedUsers[client.handshake.auth.id] || []),
      client,
    ];

    this.logger.log(
      `Socket connected: ${client.handshake.auth.id}   ${client.id}`,
    );

    const User: Prisma.UserWhereUniqueInput = {
      id: client.handshake.auth.id,
    };

    const chatList = await this.userService.getChatList(User);
    // const friendRequest = await this.userService.getAcceptedFriendRequests(User);
    const rooms = await this.userService.getRooms(User);
    const userSockets = this.connectedUsers[client.handshake.auth.id];

    for (const socket of userSockets) {
      socket.join(client.handshake.auth.id);
    }

    for (const room of rooms) {
      client.join(room);
    }
    if (chatList) client.emit(`updateChatList`, chatList);

  }

  //!---------------DISCONNECTION------------------------!//

  async handleDisconnect(socket: Socket) {

    this.connectedUsers[socket.handshake.auth.id].splice(
      this.connectedUsers[socket.handshake.auth.id].indexOf(socket),
      1,
    );

    socket.leave(socket.id);

    this.logger.log(`Socket disconnected: ${socket.id}`);
  }

  //!---------------getting Users ------------------------!//

  @SubscribeMessage(`getChatList`)
  async getUsers(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { UserId: string },
  ): Promise<any> {
    try {
      const User: Prisma.UserWhereUniqueInput = {
        id: client.handshake.auth.id,
      };
      const users = await this.userService.getChatList(User);
      client.emit(`getChatList`, users);
    } catch (error) {
      console.error(`Error in getting users`, error);
    }
  }

  @SubscribeMessage(`getFriendList`)
  async getFriendList(
    @ConnectedSocket() clinet: Socket,
    @MessageBody() userId: string
  ): Promise<any> {
    const FriendList = await this.userService.getFriendList(userId);
    clinet.emit(`updateFriendList`, FriendList)
    return FriendList
  }

  @SubscribeMessage(`sendNotification`)
  async sendNotification(
    @ConnectedSocket() client: Socket,
    @MessageBody() data,
  ): Promise<any> {
    try {
      if (data.type === 'friendRequest') {
        await this.userService.notifyFriendRequest(
          client.handshake.auth.id,
          data.friendId,
        );
        if (this.connectedUsers[data.friendId]) {
          this.connectedUsers[data.friendId].map((socket) => {
            this.server
              .to(socket.id)
              .emit('receivedNotification', {
                message: 'you have a new friend request',
              });
          });
        }
      }
    } catch (error) {
      console.error(`Error in sending notification`, error);
    }
  }

  //!---------------CREATE ROOM------------------------!//

  @SubscribeMessage(`createRoom`)
  async createRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { frienID: string },
  ): Promise<string> {
    try {

      const userId = client.handshake.auth.id;
      let room = await this.userService.getRoom(userId, data.frienID);

      if (!room) {
        room = await this.userService.creatRoom(userId, data.frienID);
      }

      const freindSocket = this.connectedUsers[data.frienID];
      const userSockets = this.connectedUsers[client.handshake.auth.id];

      for (const socket of freindSocket) {
        socket.join(room);
      }
      for (const socket of userSockets) {
        socket.join(room);
      }

      return `DMs room created`;
    } catch (error) {
      console.error(`Error in creating Room`, error);
    }
  }
  //!---------------UPDATE CHAT LIST------------------------!//

  @SubscribeMessage(`updateChatList`)
  async updateChatList(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { frienID: string },
  ): Promise<any> {
    try {
      const User: Prisma.UserWhereUniqueInput = {
        id: client.handshake.auth.id,
      };
      const friend: Prisma.UserWhereUniqueInput = { id: data.frienID };
      await this.userService.addToChat(User, friend);
      const friedList = await this.userService.getChatList(User);
      const userSockets = this.connectedUsers[client.handshake.auth.id];
      for (const socket of userSockets) {
        this.server.to(socket.id).emit(`updateChatList`, friedList);
      }
    } catch (error) {
      console.error(`Error in updating chat list`, error);
    }
  }

  //!---------------PRIVATE MESSAGE------------------------!//

  @SubscribeMessage(`sendPrivateMessage`)
  async sendPrivateMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { reciverId: string; message: string },
  ): Promise<any> {
    try {
      const userId = client.handshake.auth.id;
      const user: Prisma.UserWhereUniqueInput = { id: userId };
      const friend: Prisma.UserWhereUniqueInput = { id: data.reciverId };
      let room = await this.userService.getRoom(userId, data.reciverId);
      let userBlocked = await this.userService.checkIfBlocked(user, friend);
      if (userBlocked) return;
      await this.userService.addToChat(friend, user);
      const friedList = await this.userService.getChatList(friend);
      const friendSocket = this.connectedUsers[data.reciverId];
      const userSockets = this.connectedUsers[client.handshake.auth.id];
      if (!room) {
        room = await this.userService.creatRoom(userId, data.reciverId);
      }

      for (const socket of friendSocket) {
        socket.join(room);
      }
      for (const socket of userSockets) {
        socket.join(room);
      }
      if (friendSocket) {
        for (const socket of friendSocket) {
          this.server.to(socket.id).emit(`updateChatList`, friedList);
        }
      }

      const message = await this.userService.createMessage({
        authorName: userId,
        reciverID: room,
        content: data.message,
        reciverName: data.reciverId,
      });
      this.server.to(room).emit(`receivedPrivateMessage`, { message });

    } catch (error) {
      console.error(`Error in sending private message`, error);
    }
  }

  //!--------------- BLOCK && UNBLOCK------------------------!//

  @SubscribeMessage(`blockUser`)
  async blockUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { friendId: string },
  ): Promise<any> {
    try {
      const User: Prisma.UserWhereUniqueInput = {
        id: client.handshake.auth.id,
      };
      const friend: Prisma.UserWhereUniqueInput = { id: data.friendId };
      await this.userService.blockUser(User, friend);
      const friendSocket = this.connectedUsers[data.friendId];
      const userSockets = this.connectedUsers[client.handshake.auth.id];
      const userId = await this.userService.getUser(User);

      const responce = await this.userService.AskFriendshipStatus(User, friend);

      if (userSockets) {
        for (const socket of userSockets) {
          this.server.to(socket.id).emit(`userBlocked`, userId);
          this.server.to(socket.id).emit(`FriendshipStatus`, responce);
        }
      }
      if (friendSocket) {
        for (const socket of friendSocket) {

          this.server.to(socket.id).emit(`userBlockedYou`, User);
          this.server.to(socket.id).emit(`friendRemoved`, userId);
        }
      }
      return "User blocked";
    } catch (error) {
      console.error(`Error in blocking user`, error);
    }
  }

  @SubscribeMessage(`unblockUser`)
  async unblockUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { friendId: string },
  ): Promise<any> {
    try {
      const User: Prisma.UserWhereUniqueInput = {
        id: client.handshake.auth.id,
      };
      const friend: Prisma.UserWhereUniqueInput = { id: data.friendId };
      await this.userService.unblockUser(User, friend);
      const friendSocket = this.connectedUsers[data.friendId];
      const userSockets = this.connectedUsers[client.handshake.auth.id];
      const userId = await this.userService.getUser(User);
      const responce = await this.userService.AskFriendshipStatus(User, friend);
      if (userSockets) {
        for (const socket of userSockets) {
          this.server.to(socket.id).emit(`userUnblocked`, userId);
          this.server.to(socket.id).emit(`FriendshipStatus`, responce);
        }
      }
      return "User unblocked";
    } catch (error) {
      console.error(`Error in unblocking user`, error);
    }
  }

  //!---------------Friend Request------------------------!//


  @SubscribeMessage(`getNotifications`)
  async getNotifications(
    @ConnectedSocket() client: Socket,
  ): Promise<any> {
    try {

      const notifications = await this.userService.getNotifications(client.handshake.auth.id);
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server.to(socket.id).emit(`getNotifications`, notifications);
      });
    } catch (error) {
      console.error(`Error in getting notifications`, error);
    }
  }


  @SubscribeMessage(`readNotification`)
  async readNotification(
    @ConnectedSocket() client: Socket,

  ): Promise<any> {
    try {
      const User: Prisma.UserWhereUniqueInput = {
        id: client.handshake.auth.id,
      };

      let notifications = await this.userService.getNotifications(client.handshake.auth.id);
      notifications.map(async (notification) => {
        await this.userService.readNotification(notification.id);
      })
      notifications = await this.userService.getNotifications(client.handshake.auth.id);

      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server.to(socket.id).emit(`getNotifications`, notifications);
      });
    } catch (error) {
      console.error(`Error in reading notification`, error);
    }
  }


  @SubscribeMessage(`sendFriendRequest`)
  async sendFriendRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { friendId: string },
  ): Promise<any> {
    try {
      const friendSocket = this.connectedUsers[data.friendId];
      const UserSockets = this.connectedUsers[client.handshake.auth.id];

      const User: Prisma.UserWhereUniqueInput = {
        id: client.handshake.auth.id,
      };
      const friend: Prisma.UserWhereUniqueInput = { id: data.friendId };
      const friendRequest = await this.userService.sendFriendRequest(
        User,
        friend,
      );
      await this.userService.notifyFriendRequest(client.handshake.auth.id, data.friendId);

      const friendId = await this.userService.getUser(User);
      const notifications = await this.userService.getNotifications(data.friendId);
      const UserResponce = await this.userService.AskFriendshipStatus(User, friend);
      const FriendResponce = await this.userService.AskFriendshipStatus(friend, User);
      



      if (friendSocket) {
        for (const socket of friendSocket) {
          this.server.to(socket.id).emit(`getNotifications`, notifications);
          this.server.to(socket.id).emit(`receivedFreindRequest`, friendId);
          this.server.to(socket.id).emit(`FriendshipStatus`, FriendResponce);
        }
      }
      if (UserSockets) {
        for (const socket of UserSockets) {
          this.server.to(socket.id).emit(`FriendshipStatus`, UserResponce);
        }
      }

      return "Friend request sent";
    } catch (error) {
      console.error(`Error in sending freind request`, error);
    }
  }

  @SubscribeMessage(`acceptFreindRequest`)
  async acceptFreindRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { friendId: string },
  ): Promise<any> {
    try {
      const User: Prisma.UserWhereUniqueInput = {
        id: client.handshake.auth.id,
      };
      const friend: Prisma.UserWhereUniqueInput = { id: data.friendId };
      const responce = await this.userService.acceptFriendRequest(User, friend);
      const Friend: any = await this.userService.getUser(friend);
      // const user : any = await this.userService.getUser(User);

      await this.userService.removeNotification(client.handshake.auth.id, data.friendId)

      if (responce === `Friend request accepted`) {
        const notifications = await this.userService.getNotifications(client.handshake.auth.id);
        const userSockets = this.connectedUsers[friend.id];
        const FriendResponce = await this.userService.AskFriendshipStatus(User, friend);
        const UserResponce = await this.userService.AskFriendshipStatus(friend, User);
        if (userSockets) {
          for (const socket of userSockets) {

            this.server.to(socket.id).emit(`friendRequestAccepted`, Friend);
            this.server.to(socket.id).emit(`FriendshipStatus`, UserResponce);

          }
        }
        this.connectedUsers[client.handshake.auth.id].map((socket) => {

          this.server.to(socket.id).emit(`getNotifications`, notifications);
          this.server.to(socket.id).emit(`friendRequestAccepted`);
          this.server.to(socket.id).emit(`FriendshipStatus`, FriendResponce);

        })
      }
    } catch (error) {
      console.error(`Error in accepting freind request`, error);
    }
  }

  @SubscribeMessage(`rejectFreindRequest`)
  async rejectFreindRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { friendId: string },
  ): Promise<any> {
    try {
      const User: Prisma.UserWhereUniqueInput = {
        id: client.handshake.auth.id,
      };
      const UserId = await this.userService.getUser(User);
      const userSockets = this.connectedUsers[data.friendId];
      const friend: Prisma.UserWhereUniqueInput = { id: data.friendId };

      await this.userService.declineFriendRequest(User, friend);
      await this.userService.removeNotification(client.handshake.auth.id, data.friendId)
      const notifications = await this.userService.getNotifications(client.handshake.auth.id);
      const FriendResponce = await this.userService.AskFriendshipStatus(User, friend);
      const UserResponce = await this.userService.AskFriendshipStatus(friend, User);
      for (const socket of userSockets) {
        this.server.to(socket.id).emit(`friendRequestRejected`, UserId);
        this.server.to(socket.id).emit(`FriendshipStatus`, UserResponce);
      }
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server.to(socket.id).emit(`getNotifications`, notifications);
        this.server.to(socket.id).emit(`friendRequestRejected`);
        this.server.to(socket.id).emit(`FriendshipStatus`, FriendResponce);
      })
    } catch (error) {
      console.error(`Error in rejecting freind request`, error);
    }
  }

  @SubscribeMessage(`removeFriend`)
  async removeFreind(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { friendId: string },
  ): Promise<any> {
    try {
      const User: Prisma.UserWhereUniqueInput = {
        id: client.handshake.auth.id,
      };
      const friend: Prisma.UserWhereUniqueInput = { id: data.friendId };
      const responce = await this.userService.removeFriend(User, friend);
      const userId = await this.userService.getUser(User);
      const friendId = await this.userService.getUser(friend);

      const FriendResponce = await this.userService.AskFriendshipStatus(User, friend);
      const UserResponce = await this.userService.AskFriendshipStatus(friend, User);
      const Users = await this.userService.getFriendList(data.friendId)

      this.logger.log(Users);
      if (responce === `Friend removed`) {
        const friendSocket = this.connectedUsers[data.friendId];
        const userSockets = this.connectedUsers[client.handshake.auth.id];
        if (friendSocket) {
          for (const socket of friendSocket) {
            this.server.to(socket.id).emit(`friendRemoved`, userId);
            this.server.to(socket.id).emit(`FriendshipStatus`, UserResponce);
          }
        }
        if (userSockets) {
          for (const socket of userSockets) {
            this.server.to(socket.id).emit(`friendRemoved`, friendId);
            this.server.to(socket.id).emit(`FriendshipStatus`, FriendResponce);
          }
        }
      }
      return "Friend removed";
    } catch (error) {
      console.error(`Error in removing freind`, error);
    }
  }

  @SubscribeMessage(`removeChatUser`)
  async removeChatUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { friendId: string },
  ): Promise<any> {
    try {
      const User: Prisma.UserWhereUniqueInput = {
        id: client.handshake.auth.id,
      };
      const friend: Prisma.UserWhereUniqueInput = { id: data.friendId };
      const responce = await this.userService.removeFromChat(User, friend);
      const friedList = await this.userService.getChatList(User);
      if (responce === `User removed from chat list`) {
        const userSockets = this.connectedUsers[client.handshake.auth.id];
        if (userSockets) {
          for (const socket of userSockets) {
            this.server.to(socket.id).emit(`updateChatList`, friedList);
          }
        }
      }
    } catch (error) {
      console.error(`Error in removing chat user`, error);
    }
  }

  @SubscribeMessage(`AskFriendshipStatus`)
  async AskFriendshipStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { friendId: string },
  ):
    Promise<any> {
    const User: Prisma.UserWhereUniqueInput = {
      id: client.handshake.auth.id,
    };
    const friend: Prisma.UserWhereUniqueInput = { id: data.friendId };
    const UserSockets = this.connectedUsers[client.handshake.auth.id];
    const responce = await this.userService.AskFriendshipStatus(User, friend);
    for(const socket of UserSockets) {
      this.server.to(socket.id).emit(`FriendshipStatus`, responce);
    }
  }

  @SubscribeMessage('joinChannel')
  async joinChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ): Promise<any> {
    const channel: any = await this.channelService.getchannelinfo(
      data.channelId,
    );

    const user: any = await this.userService.getUserbyId(client.handshake.auth.id);

    if (channel && user) {
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        socket.join(channel.id);
      });
      this.server
        .to(channel.id)
        .emit(
          'joinChannel',
          'UserJoined ' + data.channelId + '  ' + user.username,
        );
    }
  }

  @SubscribeMessage('sendMessage')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ): Promise<any> {
    const channel: any = await this.channelService.getchannelinfo(
      data.channelId,
    );
    const user = await this.userService.getUserbyId(client.handshake.auth.id);
    const member: any = await this.channelService.getchannelmemberinfo(
      data.channelId,
      client.handshake.auth.id,
    );

    if (member && member.isMuted) {
      if (member.timeMuted > new Date()) {
        this.connectedUsers[client.handshake.auth.id].map((socket) => {
          this.server
            .to(socket.id)
            .emit('sendMessage', { status: 'You are muted' });
        });

        return;
      } else {
        await this.channelService.unmuteMember(
          data.channelId,
          client.handshake.auth.id,
        );
      }
    }
    if (channel && user) {
      const channelMessage = await this.messageService.createmessage({
        content: data.message,
        userId: client.handshake.auth.id,
        reciverId: data.channelId,
      });

      if (channelMessage) {
        this.server.to(channel.id).emit('receivedMessage', {
          channelId: data.channelId,
          message: channelMessage,
        });
      }
    }
  }

  @SubscribeMessage('createChannel')
  async createChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ): Promise<any> {

    try {
      //   const user = await this.userService.getUserbyId(data.userId);
      const user: any = await this.userService.getUserbyId(
        client.handshake.auth.id,
      );
      data.userId = user.id;
      const channel: any = await this.channelService.createchannel(data);

      if (channel.status === 'channel created') {
        this.connectedUsers[client.handshake.auth.id].map((socket) => {
          socket.join(channel.channel.id);
        });
        this.server.to(channel.channel.id).emit('channelCreated', {
          channelId: channel.id,
          message: 'Channel Created',
          userId: data.userId,
          channel: channel.channel,
        });
      } else {
        this.connectedUsers[client.handshake.auth.id].map((socket) => {
          this.server.to(socket.id).emit('channelCreated', {
            channelId: data.channelId,
            message: channel.status,
          });
        });
      }
    } catch (error) {
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server.to(socket.id).emit('channelCreated', {
          channelId: data.channelId,
          message: "channel doesn't exist",
        });
      });
    }
  }

  @SubscribeMessage('enterChannel')
  async enterChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ): Promise<any> {
    try {
      let channel: any = await this.channelService.getchannelinfo(
        data.channelId,
      );
      const user: any = await this.userService.getUserbyId(
        client.handshake.auth.id,
      );

      channel = await this.channelService.enterchannel(
        channel.name,
        client.handshake.auth.id,
      );
      if (channel.status === 'you are now member of the channel') {
        this.connectedUsers[client.handshake.auth.id].map((socket) => {
          socket.join(channel.id);
        });
        this.server.to(channel.id).emit('channelEntered', {
          channelId: data.channelId,
          message: user.username + ' entered the channel',
          userId: client.handshake.auth.id,
          channel: channel.channel,
        });
      } else {
        this.connectedUsers[client.handshake.auth.id].map((socket) => {
          this.server.to(socket.id).emit('channelEntered', {
            channelId: data.channelId,
            message: "channel doesn't exist",
          });
        });
      }
    } catch (error) {
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server.to(socket.id).emit('channelEntered', {
          channelId: data.channelId,
          message: "channel doesn't exist",
        });
      });
    }
  }

  @SubscribeMessage('getChannels')
  async getChannels(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    const channels = await this.channelService.getallchannels(
      client.handshake.auth.id,
    );
    this.connectedUsers[client.handshake.auth.id].map((socket) => {
      this.server.to(socket.id).emit('allchannels', { channels: channels });
    });
  }

  @SubscribeMessage('getChannelsFirstTime')
  async getChannelsFirstTime(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    const channels = await this.channelService.getallchannels(
      client.handshake.auth.id,
    );
    this.connectedUsers[client.handshake.auth.id].map((socket) => {
      this.server
        .to(socket.id)
        .emit('getChannelsFirstTime', { channels: channels });
    });
  }

  @SubscribeMessage('leaveChannel')
  async leaveChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ): Promise<any> {
    try {

      const channel: any = await this.channelService.getchannelinfo(data.channelId);
      const user: any = await this.userService.getUserbyId(client.handshake.auth.id);
      const channelStatus = await this.channelService.leaveChannel(channel.name, client.handshake.auth.id);
      const channels = await this.channelService.getallchannels(client.handshake.auth.id);

      this.server.to(channel.id).emit('channelLeft', { channelId: data.channelId, message: user.username + " left the channel", userId: client.handshake.auth.id });

      const members = await this.channelService.getallmembers(data.channelId);
      this.server
        .to(channel.id)
        .emit('allmembers', { members: members, channelId: data.channelId });

      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server.to(socket.id).emit('allchannels', { channels: channels });
      });

      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        socket.leave(channel.id);
      });
    } catch (error) {
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server
          .to(socket.id)
          .emit('channelLeft', {
            channelId: data.channelId,
            message: 'error has occurred',
          });
      });
    }
  }

  @SubscribeMessage('deleteChannel')
  async deleteChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    try {
      const channel = await this.channelService.deleteChannel(
        data.channelId,
        client.handshake.auth.id,
      );

      if (channel.status == 'You are not the owner of the channel') {
        this.connectedUsers[client.handshake.auth.id].map((socket) => {
          this.server.to(socket.id).emit('channelDeleted', {
            status: 'You are not owner of the channel',
          });
        });
      } else {
        this.server.to(data.channelId).emit('channelDeleted', {
          status: 'Channel is deleted',
          channelId: data.channelId,
        });
      }
    } catch (error) {
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server.to(socket.id).emit('channelDeleted', {
          status: "Channel can't be deleted",
          channelId: data.channelId,
        });
      });
    }
  }

  @SubscribeMessage('getmembers')
  async getmembers(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    const members = await this.channelService.getallmembers(data.channelId);
    this.connectedUsers[client.handshake.auth.id].map((socket) => {
      this.server.to(socket.id).emit('allmembers', { members: members });
    });
  }

  @SubscribeMessage('setadministrator')
  async setAdministrator(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    try {
      const channel: any = await this.channelService.getchannelinfo(
        data.channelId,
      );
      const admin: any = await this.channelService.setAdministrator(
        data.channelId,
        client.handshake.auth.id,
        data.adminId,
      );
      const user: any = await this.userService.getUserbyId(data.adminId);

      if (admin.status === "This member can't be set as an administrator.") {
        this.connectedUsers[client.handshake.auth.id].map((socket) => {
          this.server.to(socket.id).emit('setAdministrator', {
            status: "This member can't be set as an administrator.",
          });
        });
      } else {
        this.server.to(channel.id).emit('setAdministrator', {
          member: admin.channelmember,
          status: user.username + ' is now an administrator.',
        });
      }
    } catch (error) {
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server.to(socket.id).emit('setAdministrator', {
          status: "This member can't be set as an administrator.",
        });
      });
    }
  }

  @SubscribeMessage('removeadministrator')
  async removeAdministrator(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    try {
      const channel: any = await this.channelService.getchannelinfo(
        data.channelId,
      );
      const member: any = await this.channelService.removeAdministrator(
        data.channelId,
        client.handshake.auth.id,
        data.adminId,
      );
      const user: any = await this.userService.getUserbyId(data.adminId);

      if (member.status === "This administrator can't be removed.") {
        this.connectedUsers[client.handshake.auth.id].map((socket) => {
          this.server.to(socket.id).emit('removeAdministrator', {
            status: "This member can't be removed as an administrator.",
          });
        });
      } else {
        this.server.to(channel.id).emit('removeAdministrator', {
          member: member.channelmember,
          status: user.username + ' is no longer an administrator.',
        });
      }
    } catch (error) {
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server.to(socket.id).emit('setAdministrator', {
          status: "This member can't be set as an administrator1.",
        });
      });
    }
  }

  @SubscribeMessage('setpassword')
  async setpassword(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    try {
      const channel: any = await this.channelService.getchannelinfo(
        data.channelId,
      );
      const user = await this.userService.getUserbyId(client.handshake.auth.id)


      if (channel && user) {
        const newchannel: any = await this.channelService.setpassword(
          data.channelId,
          client.handshake.auth.id,
          data.password,
        );

        if (newchannel.status == 'Password is set. Channel is private now') {
          this.server
            .to(channel.id)
            .emit('setpassword', {
              status: newchannel.status,
              channel: newchannel.channel,
            });
        } else if (
          newchannel.status === 'You are not the owner of the channel'
        ) {
          this.connectedUsers[client.handshake.auth.id].map((socket) => {
            this.server
              .to(socket.id)
              .emit('setpassword', { status: 'channel is already protected' });
          });
        } else {
          this.connectedUsers[client.handshake.auth.id].map((socket) => {
            this.server.to(socket.id).emit('setpassword', {
              status: 'You are not owner or admin of the channel',
            });
          });
        }
      }
    } catch (error) {
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server
          .to(socket.id)
          .emit('setpassword', { status: "password can't be set" });
      });
    }
  }

  @SubscribeMessage('removepassword')
  async removepassword(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    try {
      const channel: any = await this.channelService.getchannelinfo(
        data.channelId,
      );
      const user = await this.userService.getUserbyId(client.handshake.auth.id);

      if (channel && user) {
        const newchannel: any = await this.channelService.removepassword(
          data.channelId,
          client.handshake.auth.id,
        );

        if (
          newchannel.status === 'Password is removed. Channel is public now'
        ) {
          this.server.to(channel.id).emit('removepassword', {
            status: 'Password is removed. Channel is public now',
            channel: newchannel.channel,
          });
        } else if (
          newchannel.status === 'You are not the owner of the channel'
        ) {
          this.connectedUsers[client.handshake.auth.id].map((socket) => {
            this.server
              .to(socket.id)
              .emit('removepassword', { status: 'channel is already public' });
          });
        } else {
          this.connectedUsers[client.handshake.auth.id].map((socket) => {
            this.server.to(socket.id).emit('removepassword', {
              status: 'You are not owner or admin of the channel',
            });
          });
        }
      }
    } catch (error) {
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server
          .to(socket.id)
          .emit('removepassword', { status: "password can't be removed" });
      });
    }
  }

  @SubscribeMessage('changepassword')
  async changepassword(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    try {
      const channel: any = await this.channelService.getchannelinfo(
        data.channelId,
      );
      const user = await this.userService.getUserbyId(client.handshake.auth.id);

      if (channel && user) {
        const newchannel: any = await this.channelService.changepassword(
          data.channelId,
          client.handshake.auth.id,
          data.currentpassword,
          data.newpassword,
        );

        if (newchannel.status === 'Password is changed') {
          this.server.to(channel.id).emit('changepassword', {
            status: 'Password is changed',
            channel: newchannel.channel,
          });
        } else if (
          newchannel.status === 'You are not the owner of the channel'
        ) {
          this.connectedUsers[client.handshake.auth.id].map((socket) => {
            this.server.to(socket.id).emit('changepassword', {
              status: 'You are not the owner of the channel',
            });
          });
        } else if (newchannel.status === 'Current password is wrong') {
          this.connectedUsers[client.handshake.auth.id].map((socket) => {
            this.server
              .to(socket.id)
              .emit('changepassword', { status: 'Current password is wrong' });
          });
        } else {
          this.connectedUsers[client.handshake.auth.id].map((socket) => {
            this.server
              .to(socket.id)
              .emit('changepassword', { status: 'You are not authorized' });
          });
        }
      }
    } catch (error) {
      console.log(error);
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server
          .to(socket.id)
          .emit('changepassword', { status: "password can't be changed" });
      });
    }
  }

  @SubscribeMessage('mutemember')
  async mutemember(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    try {
      const channel: any = await this.channelService.getchannelinfo(
        data.channelId,
      );

      const mutedmember = await this.channelService.mutemember(
        data.channelId,
        client.handshake.auth.id,
        data.memberId,
      );
      if (mutedmember.status === 'This member is muted.')
        if (this.connectedUsers[data.memberId]) {
          this.connectedUsers[data.memberId].map((socket) => {
            this.server.to(socket.id).emit('mutemember', {
              status: 'you have been muted from channel',
            });
          });
        } else {
          this.connectedUsers[client.handshake.auth.id].map((socket) => {
            this.server
              .to(socket.id)
              .emit('mutemember', { status: mutedmember.status });
          });
        }
    } catch (error) {
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server
          .to(socket.id)
          .emit('mutemember', { status: "member can't be muted" });
      });
    }
  }

  @SubscribeMessage('kickmember')
  async kickmember(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    try {

      const channel: any = await this.channelService.getchannelinfo(
        data.channelId,
      );
      
      const member: any = await this.channelService.getchannelmemberinfo(
        data.channelId,
        data.memberId,
        );
        if (member.role != 'OWNER') {
        await this.channelService.leaveChannel(channel.name, data.memberId);
        if (this.connectedUsers[data.memberId]) {
          this.connectedUsers[data.memberId].map((socket) => {
            this.server
              .to(socket.id)
              .emit('kickmember', {
                status: 'you have been kicked from channel',
                message: 'you have been kicked from ' + channel.name,
                channel: channel,
              });
          });
        }
      } else {
        this.connectedUsers[client.handshake.auth.id].map((socket) => {
          this.server
            .to(socket.id)
            .emit('kickmember', { status: "member can't be kicked" });
        });
      }
    } catch (error) {
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server
          .to(socket.id)
          .emit('kickmember', { status: "member can't be kicked" });
      });
    }
  }

  @SubscribeMessage('banmember')
  async banmember(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    const status = await this.channelService.banMember(
      data.channelId,
      client.handshake.auth.id,
      data.memberId,
    );

    if (status.status === 'This member is banned.') {
      if (this.connectedUsers[data.memberId]) {
        this.connectedUsers[data.memberId].map((socket) => {
          this.server
            .to(socket.id)
            .emit('banmember', { status: 'you have been banned from channel' });
        });
      }
    } else {
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server.to(socket.id).emit('banmember', { status: status.status });
      });
    }
  }

  @SubscribeMessage('unbanmember')
  async unbanmember(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    const status = await this.channelService.unbanMember(
      data.channelId,
      client.handshake.auth.id,
      data.memberId,
    );

    if (status.status === 'This member is unbanned.') {
      if (this.connectedUsers[data.memberId]) {
        this.connectedUsers[data.memberId].map((socket) => {
          this.server.to(socket.id).emit('unbanmember', {
            status: 'you have been unbanned from channel',
          });
        });
      }
    } else {
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server
          .to(socket.id)
          .emit('unbanmember', { status: status.status });
      });
    }
  }

  @SubscribeMessage('inviteMember')
  async inviteMember(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    try {
      const status = await this.channelService.inviteMember(
        data.channelId,
        client.handshake.auth.id,
        data.memberId,
      );

      if (status.status === 'this member is invited') {
        if (this.connectedUsers[data.memberId]) {
          this.connectedUsers[data.memberId].map((socket) => {
            this.server.to(socket.id).emit('inviteMember', {
              status: 'you have been invited to channel',
              channel: status.channel,
            });
          });
        }
      } else {
        this.connectedUsers[client.handshake.auth.id].map((socket) => {
          this.server
            .to(socket.id)
            .emit('inviteMember', { status: status.status });
        });
      }
    } catch (error) {
      this.connectedUsers[client.handshake.auth.id].map((socket) => {
        this.server
          .to(socket.id)
          .emit('inviteMember', { status: "member can't be invited" });
      });
    }
  }
}
