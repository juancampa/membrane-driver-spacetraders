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

  if (res.status === 429 || (res.status === 408 && retry < 5)) {
    // TODO: Use res.headers.get("Retry-After") to wait the correct amount of time
    const wait = 0.5 + 1.4 ** retry;
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

export async function configure({ symbol, faction, token, email }) {
  if (token) {
    state.data = { token };
  } else if (symbol && faction) {
    delete state.data;
    const { data } = await api(
      "POST",
      "register",
      {},
      { symbol, faction, email }
    );
    state.data = data;
  } else {
    throw new Error("Must provide token or symbol and faction");
  }
}

export const Root = {
  parse({ name, value }) {
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
  events: async () => (await api("GET", "my/agent/events")).data,
  factions: () => ({}),
  contracts: () => ({}),
  ships: () => ({}),
  systems: () => ({}),
  intel: () => ({}),
  tests: () => ({}),
};

export const Tests = {
  testGetFactions: async () => {
    const factions = await root.factions.page.items.$query(`{ symbol }`);
    return Array.isArray(factions);
  },
  testGetAgent: async () => {
    const credits = await root.agent.credits;
    return typeof credits === "number";
  },
  testGetEvents: async () => {
    const events = await root.events;
    return Array.isArray(events);
  },
  testGetContracts: async () => {
    const contracts = await root.contracts.page.items.$query(`{ id }`);
    return Array.isArray(contracts);
  },
  testGetShips: async () => {
    const ships = await root.ships.page.items.$query(`{ symbol }`);
    return Array.isArray(ships);
  },
  testGetSystems: async () => {
    const systems = await root.systems.page.items.$query(`{ symbol }`);
    return Array.isArray(systems);
  },
  testServerStatus: async () => {
    const status = await root.serverStatus.status;
    return typeof status === "string";
  }
};

// // Useful information that the serve doesn't provide but we can compute from cached data.
// export const Intel = {
//   resourceLocations: async ({ args: { resourceSymbol } }) => {
//     const result = [];
//     for (const [waypoint, market] of Object.entries(state.cachedMarkets)) {
//       if (market.tradeGoods) {
//         const resource = market.tradeGoods.find(
//           ({ symbol }) => symbol === resourceSymbol
//         );
//         if (resource) {
//           result.push({ waypoint, sell: resource.sell, buy: resource.buy });
//         }
//       }
//       const resource = (market as any).transactions.find(
//         ({ symbol }) => symbol === resourceSymbol
//       );
//     }
//     if (resource) {
//       return JSON.stringify(resource.locations);
//     }
//   },
// };

export const FactionCollection = {
  one: async ({ symbol }) => {
    const res = await api("GET", `factions/${symbol}`);
    return res.data;
  },
  page: async (args) => {
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
  gref: (_, { obj }) => root.factions.one({ symbol: obj.symbol }),
};

export const ContractCollection = {
  one: async ({ id }) => {
    const res = await api("GET", `my/contracts/${id}`);
    return res.data;
  },
  page: async (args) => {
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
  gref: (_, { obj }) => root.contracts.one({ id: obj.id }),
  accept: async (_, { self }) => {
    const { id } = self.$argsAt(root.contracts.one);
    const res = await api("POST", `my/contracts/${id}/accept`);
    return res.data;
  },
  fulfill: async (_, { self }) => {
    const { id } = self.$argsAt(root.contracts.one);
    const res = await api("POST", `my/contracts/${id}/fulfill`);
    return res.data;
  },
  deliver: async (args, { self }) => {
    if (args.shipSymbol && args.ship) {
      throw new Error("Cannot specify both shipSymbol and ship");
    }
    if (args.ship) {
      args.shipSymbol = args.ship.$argsAt(root.ships.one).symbol;
    }
    const { id } = self.$argsAt(root.contracts.one);
    const res = await api("POST", `my/contracts/${id}/deliver`, {}, args);
    return res.data;
  },
};

export const ShipCollection = {
  one: async ({ symbol }) => {
    const res = await api("GET", `my/ships/${symbol}`);
    return res.data;
  },
  page: async (args) => {
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
  purchase: async ({ shipType, waypoint, waypointSymbol }) => {
    if (waypoint && waypointSymbol) {
      throw new Error(
        "Please provide waypoint or waypointSymbol but not both."
      );
    }
    if (waypoint) {
      waypointSymbol = waypoint.$argsAt(root.systems.one.waypoints.one).symbol;
    }
    const res = await api("POST", `my/ships`, {}, { shipType, waypointSymbol });
    return res.data;
  },
};

export const Ship = {
  gref: (_, { obj }) => root.ships.one({ symbol: obj.symbol }),
  status: (_, { obj }) => obj.nav.status,
  system: (_, { obj }) => {
    return root.systems.one({ symbol: obj.nav.systemSymbol });
  },
  waypoint: (_, { obj }) => {
    return root.systems
      .one({ symbol: obj.nav.systemSymbol })
      .waypoints.one({ symbol: obj.nav.waypointSymbol });
  },
  cooldown: async (_, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api("GET", `my/ships/${symbol}/cooldown`, {}, {});
    return res?.data?.remainingSeconds ?? 0;
  },
  orbit: async (_, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/orbit`,
      { shipSymbol: symbol },
      {}
    );
    return res.data;
  },
  dock: async (_, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/dock`,
      { shipSymbol: symbol },
      {}
    );
    return res.data;
  },
  negotiateContract: async (_, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/negotiate/contract`,
      { shipSymbol: symbol },
      {}
    );
    return res.data;
  },
  refuel: async (_, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/refuel`,
      { shipSymbol: symbol },
      {}
    );
    return res.data;
  },
  refine: async ({ produce }, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/refine`,
      { shipSymbol: symbol },
      { produce }
    );
    return res.data;
  },
  scanShips: async (_, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/scan/ships`,
      { shipSymbol: symbol },
      {}
    );
    return res.data;
  },
  scanSystems: async (_, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/scan/systems`,
      { shipSymbol: symbol },
      {}
    );
    return res.data;
  },
  scanWaypoints: async (_, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/scan/waypoints`,
      { shipSymbol: symbol },
      {}
    );
    return res.data;
  },
  chart: async (_, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/chart`,
      { shipSymbol: symbol },
      {}
    );
    return res.data;
  },
  extract: async (args, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/extract`,
      { shipSymbol: symbol },
      {
        survey: args.survey ? JSON.parse(args.survey) : undefined,
      }
    );
    return res.data;
  },
  purchase: async (args, { self }) => {
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
    return res.data;
  },
  transferCargo: async (args, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/transfer`,
      {},
      {
        tradeSymbol: args.tradeSymbol,
        units: args.units,
        shipSymbol: args.shipSymbol,
      }
    );
    return res.data;
  },
  jettison: async (args, { self }) => {
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
    return res.data;
  },
  installMount: async (args, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/mounts/install`,
      {},
      {
        symbol: args.symbol,
      }
    );
    return res.data;
  },
  setFlightMode: async (args, { self }) => {
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
    return res.data;
  },
  navigate: async ({ waypoint, waypointSymbol }, { self }) => {
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
    return res.data;
  },
  handleArrival: (args, { self }) => {
    self.arrived.$emit(args.waypointSymbol);
  },
  warp: async ({ waypointSymbol }, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/warp`,
      {},
      { waypointSymbol }
    );
    return res.data;
  },
  jump: async ({ systemSymbol }, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/jump`,
      {},
      { systemSymbol }
    );
    return res.data;
  },
  survey: async (_, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api("POST", `my/ships/${symbol}/survey`);
    return res.data;
  },
  sell: async ({ symbol: resourceSymbol, units }, { self }) => {
    const { symbol } = self.$argsAt(root.ships.one);
    const res = await api(
      "POST",
      `my/ships/${symbol}/sell`,
      {},
      { symbol: resourceSymbol, units: units }
    );
    return res.data;
  },
};

export const SystemCollection = {
  one: async ({ symbol }, { info }) => {
    if (!shouldFetch(info, ["symbol", "waypoints"])) {
      return { symbol };
    }
    const res = await api("GET", `systems/${symbol}`);
    return res.data;
  },
  page: async (args) => {
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
  gref: (_, { obj, context }) =>
    root.systems.one({ symbol: obj.symbol || context.systemSymbol }),
  waypoints: (_, { obj }) => obj,
};

export const WaypointCollection = {
  one: async ({ symbol }, { self, context }) => {
    let system = self.$argsAt(root.systems.one)?.symbol || context.systemSymbol;
    const res = await api("GET", `systems/${system}/waypoints/${symbol}`);
    return res.data;
  },
  page: async (args, { self, obj, context }) => {
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
  gref: (_, { self, obj, context }) => {
    let system = self.$argsAt(root.systems.one).symbol || context.systemSymbol;
    console.log("RESOLVING WAYPOINT GREF");
    return root.systems
      .one({ symbol: system })
      .waypoints.one({ symbol: obj.symbol });
  },
  orbitals: (_, { obj }) => obj.orbitals,
  traits: (_, { obj }) => obj.traits,
  chart: (_, { obj }) => obj.chart,
  faction: (_, { obj }) => {
    return FactionCollection.one({ symbol: obj.faction.symbol });
  },
  shipyard: async (_, { self, obj, context }) => {
    let system = self.$argsAt(root.systems.one)?.symbol || context.systemSymbol;
    let waypoint =
      obj.symbol ?? self.$argsAt(root.systems.one.waypoints.one)?.symbol;
    if (obj?.traits?.every((_, { symbol }) => symbol !== "SHIPYARD")) {
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
  market: async (_, { self, obj, context }) => {
    let system = self.$argsAt(root.systems.one)?.symbol || context.systemSymbol;
    let waypoint =
      obj.symbol ?? self.$argsAt(root.systems.one.waypoints.one)?.symbol;

    if (state.cachedMarkets[waypoint]?.transactions) {
      return state.cachedMarkets[waypoint];
    }

    if (obj?.traits?.every((_, { symbol }) => symbol !== "MARKETPLACE")) {
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
  jumpGate: async (_, { self, obj, context }) => {
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
      // Returns 400 when not available
      if (err.status === 400) {
        return null;
      }
      throw err;
    }
  },
};
