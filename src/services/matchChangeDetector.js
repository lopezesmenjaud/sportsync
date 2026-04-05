function detectMatchChanges(oldMatch, newMatch) {
  const changes = [];

  if (!oldMatch) {
    changes.push({
      type: "match_created",
      newMatch
    });
    return changes;
  }

  // Cambio de horario
  if (oldMatch.currentStartUtc !== newMatch.currentStartUtc) {
    changes.push({
      type: "match_time_changed",
      oldStartUtc: oldMatch.currentStartUtc,
      newStartUtc: newMatch.currentStartUtc
    });
  }

  // Cambio de estado
  if (oldMatch.status !== newMatch.status) {
    changes.push({
      type: "match_status_changed",
      oldStatus: oldMatch.status,
      newStatus: newMatch.status
    });
  }

  return changes;
}

module.exports = { detectMatchChanges };