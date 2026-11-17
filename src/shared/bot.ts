import {
  getPlayerBestTradeRatio,
  getTotalResourceCount,
  getValidCityVertices,
  getValidRoadEdges,
  getValidSettlementVertices,
  getValidSetupRoadEdges,
  getValidSetupSettlementVertices,
} from './catan';
import {
  AIDifficulty,
  ClientGameState,
  createEmptyResources,
  GameActionPayload,
  PublicPlayerGameState,
  RESOURCE_TYPES,
  ResourceMap,
  ResourceType,
  TERRAIN_TO_RESOURCE,
} from './types';

function pipScore(num: number | null): number {
  if (!num) return 0;
  return 6 - Math.abs(7 - num);
}

function makeReqId(botId: string): string {
  return `ai_${botId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Note: AI receives ONLY a projected ClientGameState for itself — never seeing human hands!
export function decideBotAction(
  clientState: ClientGameState,
  botId: string,
  difficulty: AIDifficulty = 'normal'
): GameActionPayload | null {
  const me = clientState.players.find((p) => p.id === botId);
  if (!me || !me.resources) return null;

  const currentPlayer = clientState.players[clientState.currentPlayerIndex];
  const reqId = makeReqId(botId);

  // 1. Must discard when 7 rolled
  if (
    clientState.phase === 'DISCARD' &&
    clientState.pendingDiscardPlayerIds.includes(botId)
  ) {
    const total = getTotalResourceCount(me.resources);
    const needToDiscard = Math.floor(total / 2);
    const discard = createEmptyResources();
    // Discard most abundant resources first
    const ordered = [...RESOURCE_TYPES].sort(
      (a, b) => me.resources![b] - me.resources![a]
    );
    let left = needToDiscard;
    while (left > 0) {
      for (const r of ordered) {
        if (left <= 0) break;
        if (me.resources[r] - discard[r] > 0) {
          discard[r] += 1;
          left -= 1;
        }
      }
    }
    return { type: 'DISCARD_RESOURCES', resources: discard, requestId: reqId };
  }

  // 2. Check incoming trade offers while in MAIN (AI evaluates fair/helpful trades)
  if (clientState.phase === 'MAIN' && currentPlayer?.id !== botId) {
    const pendingOffer = clientState.activeTradeOffers.find(
      (o) =>
        o.fromPlayerId !== botId &&
        (!o.targetPlayerId || o.targetPlayerId === botId) &&
        !o.rejectedBy.includes(botId)
    );
    if (pendingOffer) {
      const canAfford = RESOURCE_TYPES.every(
        (r) => (me.resources![r] ?? 0) >= pendingOffer.want[r]
      );
      if (canAfford && difficulty !== 'easy') {
        // Accept if we get at least as many cards as we give AND we need what's offered
        const giveCount = getTotalResourceCount(pendingOffer.want);
        const getCount = getTotalResourceCount(pendingOffer.give);
        const needsOffered = RESOURCE_TYPES.some(
          (r) => pendingOffer.give[r] > 0 && me.resources![r] === 0
        );
        if (getCount > giveCount || (getCount === giveCount && needsOffered)) {
          return { type: 'ACCEPT_TRADE', offerId: pendingOffer.id, requestId: reqId };
        }
      }
      return { type: 'REJECT_TRADE', offerId: pendingOffer.id, requestId: reqId };
    }
    return null;
  }

  // Not our turn
  if (currentPlayer?.id !== botId) return null;

  // 3. Setup settlement
  if (clientState.phase === 'SETUP_SETTLEMENT') {
    const valid = getValidSetupSettlementVertices(clientState as never);
    if (valid.length === 0) return null;

    if (difficulty === 'easy') {
      const pick = valid[Math.floor(Math.random() * valid.length)];
      return { type: 'PLACE_SETUP_SETTLEMENT', vertexId: pick, requestId: reqId };
    }

    const scored = valid.map((vid) => {
      const v = clientState.vertices[vid];
      let score = 0;
      const seenRes = new Set<ResourceType>();
      for (const hid of v.adjacentHexIds) {
        const hex = clientState.hexes[hid];
        if (!hex) continue;
        score += pipScore(hex.numberToken) * 2;
        const res = TERRAIN_TO_RESOURCE[hex.terrain];
        if (res && !seenRes.has(res)) {
          seenRes.add(res);
          score += 3;
        }
        // Prefer wood/brick/wheat/ore slightly
        if (res === 'wheat' || res === 'ore' || res === 'brick' || res === 'wood') {
          score += 1;
        }
      }
      if (v.portId) score += 2;
      return { vid, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return { type: 'PLACE_SETUP_SETTLEMENT', vertexId: scored[0].vid, requestId: reqId };
  }

  // 4. Setup road
  if (clientState.phase === 'SETUP_ROAD') {
    const valid = getValidSetupRoadEdges(
      clientState as never,
      clientState.setupLastSettlementVertexId
    );
    if (valid.length === 0) return null;
    // Prefer road heading toward center or port
    const scored = valid.map((eid) => {
      const edge = clientState.edges[eid];
      const distFromCenter = Math.hypot(edge.mx, edge.my);
      return { eid, score: -distFromCenter };
    });
    scored.sort((a, b) => b.score - a.score);
    return { type: 'PLACE_SETUP_ROAD', edgeId: scored[0].eid, requestId: reqId };
  }

  // 5. Roll dice (optionally play Knight first on hard if robber is on our tile)
  if (clientState.phase === 'ROLL') {
    const hasKnight = me.devCards?.includes('knight') && !clientState.devCardPlayedThisTurn;
    const robberHex = clientState.hexes.find((h) => h.id === clientState.robberHexId);
    const robberBlocksMe = robberHex?.vertexIds.some(
      (vid) => clientState.vertices[vid]?.ownerId === botId
    );
    if (difficulty === 'hard' && hasKnight && robberBlocksMe) {
      return { type: 'PLAY_DEV_CARD', card: 'knight', requestId: reqId };
    }
    return { type: 'ROLL_DICE', requestId: reqId };
  }

  // 6. Move Robber
  if (clientState.phase === 'ROBBER_MOVE') {
    const candidates = clientState.hexes.filter((h) => h.id !== clientState.robberHexId);
    const scored = candidates.map((h) => {
      let score = pipScore(h.numberToken);
      let hitsMe = false;
      let hitsLeader = false;
      const leaderVP = Math.max(...clientState.players.map((p) => p.publicVP));
      for (const vid of h.vertexIds) {
        const v = clientState.vertices[vid];
        if (!v || !v.ownerId) continue;
        if (v.ownerId === botId) hitsMe = true;
        else {
          const opp = clientState.players.find((p) => p.id === v.ownerId);
          if (opp && opp.publicVP >= leaderVP) hitsLeader = true;
          score += v.building === 'city' ? 8 : 5;
        }
      }
      if (hitsMe) score -= 50;
      if (hitsLeader) score += 6;
      return { hexId: h.id, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return { type: 'MOVE_ROBBER', hexId: scored[0].hexId, requestId: reqId };
  }

  // 7. Steal Resource
  if (clientState.phase === 'ROBBER_STEAL') {
    const candidates = clientState.stealCandidatePlayerIds;
    if (candidates.length === 0) return null;
    // Steal from opponent with highest publicVP & resourceCount
    const sorted = [...candidates].sort((a, b) => {
      const pa = clientState.players.find((p) => p.id === a);
      const pb = clientState.players.find((p) => p.id === b);
      return ((pb?.publicVP ?? 0) * 10 + (pb?.resourceCount ?? 0)) -
        ((pa?.publicVP ?? 0) * 10 + (pa?.resourceCount ?? 0));
    });
    return { type: 'STEAL_RESOURCE', targetPlayerId: sorted[0], requestId: reqId };
  }

  // 8. MAIN phase
  if (clientState.phase === 'MAIN') {
    const res = me.resources;

    // Finish free roads from Road Building first
    if (clientState.freeRoadsRemaining > 0) {
      const validRoads = getValidRoadEdges(clientState as never, botId);
      if (validRoads.length > 0 && me.roadsRemaining > 0) {
        return { type: 'BUILD_ROAD', edgeId: validRoads[0], requestId: reqId };
      }
    }

    // Upgrade City (wheat 2, ore 3)
    if (me.citiesRemaining > 0 && res.wheat >= 2 && res.ore >= 3) {
      const validCities = getValidCityVertices(clientState as never, botId);
      if (validCities.length > 0) {
        return { type: 'UPGRADE_CITY', vertexId: validCities[0], requestId: reqId };
      }
    }

    // Build Settlement (wood 1, brick 1, sheep 1, wheat 1)
    if (
      me.settlementsRemaining > 0 &&
      res.wood >= 1 &&
      res.brick >= 1 &&
      res.sheep >= 1 &&
      res.wheat >= 1
    ) {
      const validSettlements = getValidSettlementVertices(clientState as never, botId);
      if (validSettlements.length > 0) {
        const best = validSettlements.sort((a, b) => {
          const scoreV = (vid: string) =>
            clientState.vertices[vid].adjacentHexIds.reduce(
              (acc, hid) => acc + pipScore(clientState.hexes[hid]?.numberToken ?? null),
              0
            );
          return scoreV(b) - scoreV(a);
        })[0];
        return { type: 'BUILD_SETTLEMENT', vertexId: best, requestId: reqId };
      }
    }

    // Play helpful dev card if allowed
    if (!clientState.devCardPlayedThisTurn && me.devCards && me.devCards.length > 0) {
      if (me.devCards.includes('yearOfPlenty')) {
        const needed = [...RESOURCE_TYPES].sort((a, b) => res[a] - res[b]);
        return {
          type: 'PLAY_DEV_CARD',
          card: 'yearOfPlenty',
          resources: [needed[0], needed[1]],
          requestId: reqId,
        };
      }
      if (me.devCards.includes('monopoly') && difficulty !== 'easy') {
        const target = [...RESOURCE_TYPES].sort((a, b) => res[a] - res[b])[0];
        return {
          type: 'PLAY_DEV_CARD',
          card: 'monopoly',
          resources: [target],
          requestId: reqId,
        };
      }
      if (me.devCards.includes('roadBuilding') && me.roadsRemaining >= 2) {
        const validRoads = getValidRoadEdges(clientState as never, botId);
        if (validRoads.length > 0) {
          return { type: 'PLAY_DEV_CARD', card: 'roadBuilding', requestId: reqId };
        }
      }
      if (me.devCards.includes('knight')) {
        return { type: 'PLAY_DEV_CARD', card: 'knight', requestId: reqId };
      }
    }

    // Build Road if we can expand toward a settlement spot or longest road
    if (me.roadsRemaining > 0 && res.wood >= 1 && res.brick >= 1) {
      const validRoads = getValidRoadEdges(clientState as never, botId);
      const validSettlements = getValidSettlementVertices(clientState as never, botId);
      // Build road if we have no settlement spots open, or plenty of wood/brick, or close to longest road
      if (
        validRoads.length > 0 &&
        (validSettlements.length === 0 || res.wood >= 2 || res.brick >= 2 || me.longestRoadLength >= 3)
      ) {
        const chosen = validRoads[Math.floor(Math.random() * validRoads.length)];
        return { type: 'BUILD_ROAD', edgeId: chosen, requestId: reqId };
      }
    }

    // Buy Dev Card (sheep 1, wheat 1, ore 1)
    if (
      clientState.devDeckRemaining > 0 &&
      res.sheep >= 1 &&
      res.wheat >= 1 &&
      res.ore >= 1
    ) {
      return { type: 'BUY_DEV_CARD', requestId: reqId };
    }

    // Bank/Port Trade if overflowing (> 4 of a resource) to avoid 7-roll penalty or get missing build resource
    if (difficulty !== 'easy') {
      for (const give of RESOURCE_TYPES) {
        const ratio = getPlayerBestTradeRatio(clientState as never, botId, give);
        if (res[give] >= ratio + 1 || (getTotalResourceCount(res) >= 7 && res[give] >= ratio)) {
          const want = [...RESOURCE_TYPES]
            .filter((r) => r !== give)
            .sort((a, b) => res[a] - res[b])[0];
          return {
            type: 'BANK_TRADE',
            give,
            giveAmount: ratio,
            want,
            requestId: reqId,
          };
        }
      }
    }

    return { type: 'END_TURN', requestId: reqId };
  }

  return null;
}

export function buildBotOfferIfAny(
  _players: PublicPlayerGameState[],
  _botId: string
): ResourceMap | null {
  return null;
}
