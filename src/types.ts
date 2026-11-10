export type PublicUser = {
  id: string;
  name: string;
  email: string;
};

export type GroupSummary = {
  id: string;
  name: string;
};

export type BoardMember = {
  userId: string;
  name: string;
  standing: number | null;
};

export type Board = {
  group: {
    id: string;
    name: string;
    joinToken: string;
  };
  viewerId: string;
  publicOrigin: string | null;
  members: BoardMember[];
};

export type Me = {
  user: PublicUser | null;
  groups: GroupSummary[];
  publicOrigin: string | null;
};

export type ScoreResult =
  | { ok: true; applies: false }
  | { ok: true; applies: true; score: number }
  | { ok: false };

export type ScoreEngine = (text: string) => Promise<ScoreResult>;

export type LogResult =
  | { outcome: "quiet" }
  | { outcome: "unchanged"; ping: false }
  | { outcome: "changed"; ping: true; board: Board }
  | { outcome: "failed"; message: string }
  | { outcome: "forbidden" };
