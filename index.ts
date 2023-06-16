// `nodes` contain any nodes you add from the graph (dependencies)
// `root` is a reference to this program's root node
// `state` is an object that persists across program updates. Store data here.
import { nodes, root, state } from "membrane";

state.cachedMarkets = state.cachedMarkets || {};
state.cachedJumpGates = state.cachedJumpGates || {};

// Helper to fetch data if only needed
type ResolverInfo = {
  fieldNodes: {
    selectionSet: {
      selections: any;
    };
  }[];
};

const shouldFetch = (info: ResolverInfo, simpleFields: string[]) =>
  info.fieldNodes
    .flatMap(({ selectionSet: { selections } }) => {
      return selections;
    })
    .some(({ name: { value } }) => !simpleFields.includes(value));

// Call to api.spacetraders.io/v2
async function api(
  method: "GET" | "POST" | "PATCH",
  path: string,
  query?: Record<string, string>,
  body?: object,
  retry: number = 0
) {
  let pathAndQuery = path;
  if (query) {
    // Remote undefined values
    Object.keys(query).forEach((key) => {
      if (query[key] === undefined) {
        delete query[key];
      }
    });

    const queryStr = new URLSearchParams(query).toString();
    pathAndQuery = `${pathAndQuery}?${queryStr}`;
  }
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (state.data?.token) {
    headers["Authorization"] = `Bearer ${state.data.token}`;
  }
  const res = await fetch(`https://api.spacetraders.io/v2/${pathAndQuery}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 429 && retry < 5) {
    // TODO: Use res.headers.get("Retry-After") to wait the correct amount of time
    const wait = Math.random() * 3 + 3;
    console.log(`Rate limited, waiting ${wait} seconds...`);
    await sleep(wait);
    return await api(method, path, query, body, retry + 1);
  }

  if (res.status >= 300) {
    const error = new Error(await res.text());
    error["status"] = res.status;
    throw error;
  }
  if (res.status === 204) {
    return {};
  }
  return await res.json();
}

export async function configure({ args: { symbol, faction, token } }) {
  if (token) {
    state.data = { token };
  } else {
    delete state.data;
    const { data } = await api("POST", "register", {}, { symbol, faction });
    state.data = data;
  }
}

export const Root = {
  parse({ args: { name, value } }) {
    switch (name) {
      case "system": {
        const [, system] = value.match(new RegExp("(X1-.{3,4})", "i"));
        if (system) {
          return [root.systems.one({ symbol: system })];
        }
        break;
      }
      case "waypoint": {
        const [, waypoint, system] = value.match(
          new RegExp("((X1-.{3,4})-.{3,6})", "i")
        );
        if (waypoint && system) {
          return [
            root.systems
              .one({ symbol: system })
              .waypoints.one({ symbol: waypoint }),
          ];
        }
        break;
      }
    }
    return [];
  },
  status: async () => {
    const agent = (await api("GET", "my/agent")).data;
    return agent ? `${agent.symbol}: ${agent.credits}` : `Not ready`;
  },
  serverStatus: async () => await api("GET", ""),
  agent: async () => (await api("GET", "my/agent")).data,
  events: async () =>
    JSON.stringify((await api("GET", "my/agent/events")).data),
  factions: () => ({}),
  contracts: () => ({}),
  ships: () => ({}),
  systems: () => ({}),
};

export const FactionCollection = {
  one: async ({ args: { symbol } }) => {
    const res = await api("GET", `factions/${symbol}`);
    return res.data;
  },
  page: async ({ args }) => {
    const res = await api("GET", "factions", {
      page: args.page,
      limit: args.limit,
    });
    return {
      items: res.data,
      next: root.factions.page({
        page: (args.page ?? 1) + 1,
        limit: args.limit,
      }),
    };
  },
};

export const Faction = {
  gref: ({ obj }) => root.factions.one({ symbol: obj.symbol }),
};

export const ContractCollection = {
  one: async ({ args: { id } }) => {
    const res = await api("GET", `my/contracts/${id}`);
    return res.data;
  },
  page: async ({ args }) => {
    const res = await api("GET", "my/contracts", {
      page: args.page,
      limit: args.limit,
    });
    return {
      items: res.data,
      next: root.contracts.page({
        page: (args.page ?? 1) + 1,
        limit: args.limit,
      }),
    };
  },
};

export const Contract = {
  gref: ({ obj }) => root.contracts.one({ id: obj.id }),
  terms: ({ obj }) => JSON.stringify(obj.terms),
  accept: async ({ self }) => {
    const { id } = self.$argsAt(root.contracts.one);
    const res = await api("POST", `my/contracts/${id}/accept`);
    return JSON.stringify(res.data);
  },
  fulfill: async ({ self }) => {
    const { id } = self.$argsAt(root.contracts.one);
    const res = await api("POST", `my/contracts/${id}/fulfill`);
    return JSON.stringify(res.data);
  },
  deliver: async ({ self, args }) => {
    if (args.shipSymbol && args.ship) {
      throw new Error("Cannot specify both shipSymbol and ship");
    }
    if (args.ship) {
      args.shipSymbol = args.ship.$argsAt(root.ships.one).symbol;
    }
    const { id } = self.$argsAt(root.contracts.one);
    const res = await api("POST", `my/contracts/${id}/deliver`, {}, args);
    return JSON.stringify(res.data);
  },
};

export const ShipCollection = {
  one: async ({ args: { symbol } }) => {
    const res = await api("GET", `my/ships/${symbol}`);
    return res.data;
  },
  page: async ({ args }) => {
    const res = await api("GET", "my/ships", {
      page: args.page,
      limit: args.limit,
    });
    const { total, page, limit } = res.meta;
    const hasNext = total > page * limit;
    return {
      items: res.data,
      next: !hasNext
        ? null
        : root.ships.page({
            page: (args.page ?? 1) + 1,
            limit: args.limit,
          }),
    };
  },
  purchase: async ({ args: { shipType, waypoint, waypointSymbol } }) => {
    if (waypoint && waypointSymbol) {
      throw new Error(
        "Please provide waypoint or waypointSymbol but not both."
      );
    }
    if (waypoint) {
      waypointSymbol = waypoint.$argsAt(root.systems.one.waypoints.one).symbol;
    }
    const res = await api("POST", `my/ships`, {}, { shipType, waypointSymbol });
    return JSON.stringify(res.data);
  },
};

export const Ship = {
  gref: ({ obj }) => root.ships.one({ symbol: obj.symbol }),
  registration: ({ obj }) => JSON.stringify(obj.registration),
  status: ({ obj }) => obj.nav.status,
  nav: ({ obj }) => JSON.stringify(obj.nav),
  crew: ({ obj }) => JSON.stringify(obj.crew),
  frame: ({ obj }) => JSON.stringify(obj.frame),
  reactor: ({ obj }) => JSON.stringify(obj.reactor),
  engine: ({ obj }) => JSON.stringify(obj.engine),
  modules: ({ obj }) => JSON.stringify(obj.modules),
  mounts: ({ obj }) => JSON.stringify(obj.mounts),
  cargo: ({ obj }) => JSON.stringify(obj.cargo),
  fuel: ({ obj }) => JSON.stringify(obj.fuel),
  system: ({ obj }) => {
    return root.systems.one({ symbol: obj.nav.systemSymbol });
  },
  waypoint: ({ obj }) => {
    return root.systems
      .one({ symbol: obj.nav.systemSymbol })
      .waypoints.one({ symbol: obj.nav.waypointSymbol });
  },
  cooldown: async ({ self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api("GET", `my/ships/${symbol}/cooldown`, {}, {});
    return res?.data?.remainingSeconds ?? 0;
  },
  orbit: async ({ self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/orbit`,
      { shipSymbol: symbol },
      {}
    );
    return JSON.stringify(res.data);
  },
  dock: async ({ self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/dock`,
      { shipSymbol: symbol },
      {}
    );
    return JSON.stringify(res.data);
  },
  negotiateContract: async ({ self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/negotiate/contract`,
      { shipSymbol: symbol },
      {}
    );
    return JSON.stringify(res.data);
  },
  refuel: async ({ self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/refuel`,
      { shipSymbol: symbol },
      {}
    );
    return JSON.stringify(res.data);
  },
  refine: async ({ self, args: { produce } }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/refine`,
      { shipSymbol: symbol },
      { produce }
    );
    return JSON.stringify(res.data);
  },
  scanShips: async ({ self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/scan/ships`,
      { shipSymbol: symbol },
      {}
    );
    return JSON.stringify(res.data);
  },
  scanSystems: async ({ self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/scan/systems`,
      { shipSymbol: symbol },
      {}
    );
    return JSON.stringify(res.data);
  },
  scanWaypoints: async ({ self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/scan/waypoints`,
      { shipSymbol: symbol },
      {}
    );
    return JSON.stringify(res.data);
  },
  chart: async ({ self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/chart`,
      { shipSymbol: symbol },
      {}
    );
    return JSON.stringify(res.data);
  },
  extract: async ({ self, args }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/extract`,
      { shipSymbol: symbol },
      {
        survey: args.survey ? JSON.parse(args.survey) : undefined,
      }
    );
    return JSON.stringify(res.data);
  },
  purchase: async ({ self, args }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/purchase`,
      { shipSymbol: symbol },
      {
        symbol: args.symbol,
        units: args.units,
      }
    );
    return JSON.stringify(res.data);
  },
  jettison: async ({ self, args }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/jettison`,
      { shipSymbol: symbol },
      {
        symbol: args.symbol,
        units: args.units,
      }
    );
    return JSON.stringify(res.data);
  },
  installMount: async ({ self, args }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/mounts/install`,
      {},
      {
        symbol: args.symbol,
      }
    );
    return JSON.stringify(res.data);
  },
  setFlightMode: async ({ self, args }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    if (!/^(CRUISE|BURN|DRIFT|STEALTH)$/.test(args.mode)) {
      throw new Error(
        "Invalid flight mode. Only CRUISE, BURN, DRIFT, STEALTH are available."
      );
    }
    const res = await api(
      "PATCH",
      `my/ships/${symbol}/nav`,
      {},
      { flightMode: args.mode }
    );
    return JSON.stringify(res.data);
  },
  navigate: async ({ self, args: { waypoint, waypointSymbol } }) => {
    if (waypoint && waypointSymbol) {
      throw new Error(
        "Please provide waypoint or waypointSymbol but not both."
      );
    }
    if (waypoint) {
      waypointSymbol = waypoint.$argsAt(root.systems.one.waypoints.one).symbol;
    }
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/navigate`,
      {},
      { waypointSymbol }
    );
    const arrival = res.data?.nav?.route?.arrival;
    if (arrival) {
      self.handleArrival({ waypointSymbol }).$invokeAt(new Date(arrival));
    }
    return JSON.stringify(res.data);
  },
  handleArrival: ({ self, args }) => {
    self.arrived.$emit(args.waypointSymbol);
  },
  warp: async ({ self, args: { systemSymbol } }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/warp`,
      {},
      { systemSymbol }
    );
    return JSON.stringify(res.data);
  },
  jump: async ({ self, args: { systemSymbol } }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/jump`,
      {},
      { systemSymbol }
    );
    return JSON.stringify(res.data);
  },
  survey: async ({ self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api("POST", `my/ships/${symbol}/survey`);
    return JSON.stringify(res.data);
  },
  sell: async ({ self, args: { symbol: resourceSymbol, units } }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/sell`,
      {},
      { symbol: resourceSymbol, units: units }
    );
    return JSON.stringify(res.data);
  },
};

export const SystemCollection = {
  one: async ({ args: { symbol }, info }) => {
    if (!shouldFetch(info, ["symbol", "waypoints"])) {
      return { symbol };
    }
    const res = await api("GET", `systems/${symbol}`);
    return res.data;
  },
  page: async ({ args }) => {
    const res = await api("GET", "systems", {
      page: args.page,
      limit: args.limit,
    });
    const { total, page, limit } = res.meta;
    const hasNext = total > page * limit;
    return {
      items: res.data,
      next: !hasNext
        ? null
        : root.systems.page({
            page: (args.page ?? 1) + 1,
            limit: args.limit,
          }),
    };
  },
};

export const System = {
  gref: ({ obj, context }) =>
    root.systems.one({ symbol: obj.symbol || context.systemSymbol }),
  waypoints: ({ obj }) => obj,
  factions: ({ obj }) => JSON.stringify(obj.factions),
};

export const WaypointCollection = {
  one: async ({ self, args: { symbol }, context }) => {
    let system = self.$argsAt(root.systems.one)?.symbol || context.systemSymbol;
    const res = await api("GET", `systems/${system}/waypoints/${symbol}`);
    return res.data;
  },
  page: async ({ self, obj, args, context }) => {
    let system = self.$argsAt(root.systems.one)?.symbol || context.systemSymbol;
    const res = await api("GET", `systems/${system}/waypoints`, {
      page: args.page,
      limit: args.limit,
    });
    const { total, page, limit } = res.meta;
    const hasNext = total > page * limit;
    return {
      items: res.data,
      next: !hasNext
        ? null
        : root.systems.one({ symbol: system }).waypoints.page({
            page: (args.page ?? 1) + 1,
            limit: args.limit,
          }),
    };
  },
};

export const Waypoint = {
  gref: ({ self, obj, context }) => {
    let system = self.$argsAt(root.systems.one).symbol || context.systemSymbol;
    return root.systems
      .one({ symbol: system })
      .waypoints.one({ symbol: obj.symbol });
  },
  orbitals: ({ obj }) => JSON.stringify(obj.orbitals),
  traits: ({ obj }) => JSON.stringify(obj.traits),
  chart: ({ obj }) => JSON.stringify(obj.chart),
  faction: ({ obj }) => {
    return FactionCollection.one({ args: { symbol: obj.faction.symbol } });
  },
  shipyard: async ({ self, obj, context }) => {
    let system = self.$argsAt(root.systems.one)?.symbol || context.systemSymbol;
    let waypoint =
      obj.symbol ?? self.$argsAt(root.systems.one.waypoints.one)?.symbol;
    if (obj?.traits?.every(({ symbol }) => symbol !== "SHIPYARD")) {
      return null;
    }
    try {
      const res = await api(
        "GET",
        `systems/${system}/waypoints/${waypoint}/shipyard`
      );
      return res.data;
    } catch (err) {
      if (err.status === 404) {
        return null;
      }
      throw err;
    }
  },
  market: async ({ self, obj, context }) => {
    let system = self.$argsAt(root.systems.one)?.symbol || context.systemSymbol;
    let waypoint =
      obj.symbol ?? self.$argsAt(root.systems.one.waypoints.one)?.symbol;

    if (state.cachedMarkets[waypoint]?.transactions) {
      return state.cachedMarkets[waypoint];
    }

    if (obj?.traits?.every(({ symbol }) => symbol !== "MARKETPLACE")) {
      return null;
    }
    try {
      const res = await api(
        "GET",
        `systems/${system}/waypoints/${waypoint}/market`
      );
      state.cachedMarkets[waypoint] = res.data;
      return res.data;
    } catch (err) {
      if (err.status === 404) {
        return null;
      }
      throw err;
    }
  },
  jumpGate: async ({ self, obj, context }) => {
    let system = self.$argsAt(root.systems.one)?.symbol || context.systemSymbol;
    let waypoint =
      obj.symbol ?? self.$argsAt(root.systems.one.waypoints.one)?.symbol;

    if (state.cachedJumpGates[waypoint]) {
      return state.cachedJumpGates[waypoint];
    }

    if (obj.type !== "JUMP_GATE") {
      return null;
    }
    try {
      const res = await api(
        "GET",
        `systems/${system}/waypoints/${waypoint}/jump-gate`
      );
      state.cachedJumpGates[waypoint] = res.data;
      return res.data;
    } catch (err) {
      if (err.status === 404) {
        return null;
      }
      throw err;
    }
  },
};

export const Market = {
  exports: ({ obj }) => JSON.stringify(obj.exports),
  imports: ({ obj }) => JSON.stringify(obj.imports),
  exchange: ({ obj }) => JSON.stringify(obj.exchange),
  transactions: ({ obj }) => JSON.stringify(obj.transactions),
  tradeGoods: ({ obj }) => JSON.stringify(obj.tradeGoods),
};

export const Shipyard = {
  shipTypes: ({ obj }) => JSON.stringify(obj.shipTypes),
  transactions: ({ obj }) => JSON.stringify(obj.transactions),
  ships: ({ obj }) => JSON.stringify(obj.ships),
};

export const JumpGate = {
  connectedSystems: ({ obj }) => JSON.stringify(obj.connectedSystems),
};

export const ServerStatus = {
  stats: ({ obj }) => JSON.stringify(obj.stats),
  leaderboards: ({ obj }) => JSON.stringify(obj.leaderboards),
  serverResets: ({ obj }) => JSON.stringify(obj.serverResets),
  announcements: ({ obj }) => JSON.stringify(obj.announcements),
  links: ({ obj }) => JSON.stringify(obj.links),
};
