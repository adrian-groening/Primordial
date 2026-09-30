import { numberInRange, validateMutation } from "./config.js";

export function makeCommand(currentTick, sequence, command) {
  if (!command || !["renewal", "mutation", "introducePredators", "impact"].includes(command.type))
    throw new RangeError("Unknown command");
  const tick = numberInRange(command.tick, "command.tick", currentTick + 1, Number.MAX_SAFE_INTEGER, true);
  const value = command.type === "impact" ? null : command.type === "renewal"
    ? numberInRange(command.value, "renewal", 0, 100)
    : command.type === "mutation"
      ? validateMutation(command.value)
      : numberInRange(command.value, "introduced predators", 0, 30, true);
  return { tick, sequence, type: command.type, value };
}

export function sortCommands(commands) {
  commands.sort((a, b) => a.tick - b.tick || a.sequence - b.sequence);
  return commands;
}
