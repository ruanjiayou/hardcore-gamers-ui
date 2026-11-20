import AuthStore from "./auth";
import GameStore from "./game";
import RoomStore from "./room";
import UiStore from "./ui";

const store = {
  auth: new AuthStore(),
  game: new GameStore(),
  room: new RoomStore(),
  ui: new UiStore(),
}

export default store;
