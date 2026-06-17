import {
  formatEntitiesTable,
  printError,
  printJson,
} from "../format.js";

const HELP = `Usage: atlas entities <query>

Look up canonical entities (people, places, objects, concepts, organizations)
by partial name. Use the returned numeric ID with \`atlas entity <id>\` to
list every memory linked to it.
`;

export const meta = {
  name: "entities",
  help: HELP,
  options: ["json"],
};

export async function run({ positional, flags, deps, json }) {
  const query = positional.join(" ").trim();
  if (!query) {
    printError("entities requires a query. Try: atlas entities Maya");
    return { exitCode: 2 };
  }

  try {
    const entities = deps.findEntities(query);
    if (json) {
      printJson({ entities });
    } else {
      console.log(formatEntitiesTable(entities));
    }
    return { exitCode: 0 };
  } catch (error) {
    printError(`Could not find entities: ${error.message}`);
    return { exitCode: 1 };
  }
}
