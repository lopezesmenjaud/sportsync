class MatchRepository {
  constructor() {
    this.matches = new Map();
  }

  getAll() {
    return Array.from(this.matches.values());
  }

  getByProviderMatchId(providerMatchId) {
    return this.matches.get(providerMatchId) || null;
  }

  save(match) {
    this.matches.set(match.providerMatchId, match);
    return match;
  }

  saveAll(matches) {
    for (const match of matches) {
      this.save(match);
    }

    return matches;
  }

  clear() {
    this.matches.clear();
  }
}

const matchRepository = new MatchRepository();

module.exports = { matchRepository };