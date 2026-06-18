const { openDoor } = require("./openDoor.cjs");
const { deviceHttp, testDeviceTcp } = require("../lib/deviceHttp.cjs");
const { cameraHlsFile } = require("./cameraHls.cjs");
const { cameraSnapshot } = require("./cameraSnapshot.cjs");

async function executeCommand(command) {
  if (command.type === "OPEN_DOOR") return openDoor(command);
  if (command.type === "TEST_DEVICE") return testDeviceTcp(command.device);
  if (command.type === "DEVICE_HTTP") return deviceHttp(command);
  if (command.type === "CAMERA_HLS_FILE") return cameraHlsFile(command);
  if (command.type === "CAMERA_SNAPSHOT") return cameraSnapshot(command);
  throw new Error(`Comando ${command.type} ainda nao suportado`);
}

module.exports = { executeCommand };
