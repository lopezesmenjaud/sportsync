class ProviderInterface {
  async getMatchesByDate() {
    throw new Error("getMatchesByDate() must be implemented by provider");
  }

  normalizeMatch() {
    throw new Error("normalizeMatch() must be implemented by provider");
  }

  mapStatus() {
    throw new Error("mapStatus() must be implemented by provider");
  }
}

module.exports = { ProviderInterface };