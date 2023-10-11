import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import { faker } from '@faker-js/faker';
import { userInfo } from 'os';
import { string } from 'zod';

async function seed() {
  const numberOfUsers = 5;
  // create users
  for (let numUser = 0; numUser < numberOfUsers; numUser++) {
    await prisma.user.upsert({
      
      where: {email: faker.internet.email() },
      update: {},
      create: {
        email: faker.internet.email(),
        username: faker.internet.userName(),
        fullname: faker.internet.displayName(),
        avatar: faker.internet.avatar(),
        coalitionUrl: faker.internet.avatar(),
        coalitionColor: faker.internet.userName(),
        accessToken: faker.internet.password(),
        refreshToken: faker.internet.password(),
        message:{
          create: {
            content: faker.lorem.text(),
            authorName:faker.internet.userName(),
            createdAt: faker.date.recent(),
            reciver: {
              connect: {id: "user2"}
            },
          }

        }
      }
    });
  }
  console.log('seeded successfully');
  console.log(`generated users`);
}
seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
