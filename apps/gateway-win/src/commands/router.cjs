const { openDoor } = require("./openDoor.cjs");
const { deviceHttp, testDeviceTcp } = require("../lib/deviceHttp.cjs");

async function executeCommand(command) {
  if (command.type === "OPEN_DOOR") return openDoor(command);
  if (command.type === "TEST_DEVICE") return testDeviceTcp(command.device);
  if (command.type === "DEVICE_HTTP") return deviceHttp(command);
  throw new Error(`Comando ${command.type} ainda nao suportado`);
}

module.exports = { executeCommand };
