import AuthStore from "./auth";
import GameStore from "./game";
import RoomStore from "./room";

const store = {
  auth: new AuthStore(),
  game: new GameStore(),
  room: new RoomStore(),
}

export default store;