
import React from "react";
import { Avatar, Text } from "@chakra-ui/react";
import Commodore from "../../../../assets/icons/Commodore.svg";
import FreaxLogo from "../../../../assets/icons/FreaxLogo.svg";
import Image from "next/image";

const GameHeader = ({
    leftScore,
    rightScore,
  }: {
    leftScore: number;
    rightScore: number;
  }) => {
    return (
      <div className="flex items-center justify-between h-[100px] bg-background-primary mx-auto rounded-lg p-10 drop-shadow-xl w-[100%]">
        <div className="flex flex-row items-center space-x-5">
          <Image
            src={FreaxLogo}
            alt="Logo"
            width={75}
            height={75}
            className="mt-9"
          />
          <Avatar size="lg" />
          <Text className="text-text-primary font-bold text-xl">UserName</Text>
        </div>
        <div className="flex flex-row items-center space-x-10">
          <Text className="text-text-primary font-bold text-6xl">
            {leftScore}
          </Text>
          <Text className="text-text-primary font-bold text-6xl">--</Text>
          <Text className="text-text-primary font-bold text-6xl">
            {rightScore}
          </Text>
        </div>
        <div className="flex flex-row items-center space-x-5">
          <Text className="text-text-primary font-bold text-xl">UserName</Text>
          <Avatar size="lg" />
          <Image
            src={Commodore}
            alt="Logo"
            width={75}
            height={75}
            className="mt-9"
          />
        </div>
      </div>
    );
  };
 
export default GameHeader;