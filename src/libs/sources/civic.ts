import config from "../../config";
import { getOrSet } from "../cache";
import { fetchJson } from "../http";
import { ElectionInfo } from "./types";

interface VoterInfoResponse {
  election?: { id?: string; name?: string; electionDay?: string };
  state?: Array<{
    electionAdministrationBody?: {
      registrationInfoUrl?: string;
      votingLocationFinderUrl?: string;
      ballotInfoUrl?: string;
    };
  }>;
}

/**
 * Upcoming election for the zip via Google Civic Information (voterInfoQuery).
 * Google removed the representatives endpoint in 2025, so this surfaces the
 * matched election + official register/find-polling/ballot links (what reliably
 * resolves from a bare zip). Returns null most of the year - no active election.
 */
export async function getElection(zip: string): Promise<ElectionInfo | null> {
  if (!config.civic.apiKey) return null;

  return getOrSet(`civic:v1:${zip}`, { ttlSeconds: config.cache.civicTtl }, async () => {
    let data: VoterInfoResponse;
    try {
      data = await fetchJson<VoterInfoResponse>(
        `https://www.googleapis.com/civicinfo/v2/voterinfo?key=${config.civic.apiKey}&address=${zip}`,
      );
    } catch {
      // voterinfo 400s when there's no election for the address - normal, hide widget.
      return null;
    }
    // Ignore the permanent VIP test election (id 2000).
    if (!data.election || data.election.id === "2000" || !data.election.electionDay) return null;
    const admin = data.state?.[0]?.electionAdministrationBody || {};
    return {
      name: data.election.name || "Upcoming election",
      electionDay: data.election.electionDay,
      registrationUrl: admin.registrationInfoUrl || null,
      pollingFinderUrl: admin.votingLocationFinderUrl || null,
      ballotUrl: admin.ballotInfoUrl || null,
    };
  });
}
