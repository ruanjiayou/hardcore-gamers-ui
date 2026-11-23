import AuthStore from "./auth";
import GameStore from "./game";
import RoomStore from "./room";
import UiStore from "./ui";
import AudioStore from "./audio";

const store = {
  auth: new AuthStore(),
  game: new GameStore(),
  room: new RoomStore(),
  ui: new UiStore(),
  audio: new AudioStore(),
}

export default store;
