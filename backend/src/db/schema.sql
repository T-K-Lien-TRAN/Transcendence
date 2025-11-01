-- =========================================
--  Database: Transcendence
--  Description: SQLite schema for user management, tournaments, matches, and stats
-- =========================================

PRAGMA foreign_keys = ON;

-- =========================================
-- USER MANAGEMENT
-- =========================================

CREATE TABLE User (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    twofa_secret TEXT
);

CREATE TABLE Friend (
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    status TEXT CHECK(status IN ('pending', 'accepted', 'blocked')) DEFAULT 'pending',
    PRIMARY KEY (user_id, friend_id),
    FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE,
    FOREIGN KEY (friend_id) REFERENCES User(id) ON DELETE CASCADE
);

CREATE TABLE OAuth (
    user_id INTEGER NOT NULL,
    service_type TEXT NOT NULL,
    PRIMARY KEY (user_id, service_type),
    FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE
);

-- =========================================
-- USER STATS
-- =========================================

CREATE TABLE UserStats (
    user_id INTEGER PRIMARY KEY,
    elo INTEGER DEFAULT 1000,
    matches_played INTEGER DEFAULT 0,
    winrate REAL DEFAULT 0.0,
    friends INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE
);

CREATE TABLE FriendsHistory (
    user_id INTEGER NOT NULL,
    count INTEGER DEFAULT 0,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, date),
    FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE
);

CREATE TABLE MatchHistory (
    match_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    opponent_id INTEGER NOT NULL,
    user_score INTEGER DEFAULT 0,
    opponent_score INTEGER DEFAULT 0,
    user_elo INTEGER DEFAULT 1000,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    result TEXT CHECK(result IN ('win', 'loss', 'draw')) DEFAULT 'draw',
    FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE,
    FOREIGN KEY (opponent_id) REFERENCES User(id) ON DELETE CASCADE
);

-- =========================================
-- TOURNAMENT
-- =========================================

CREATE TABLE Tournament (
    tournament_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT CHECK(status IN ('pending', 'ongoing', 'finished')) DEFAULT 'pending',
    max_players INTEGER DEFAULT 8,
    is_private BOOLEAN DEFAULT 0,
    password TEXT,
    admin_id INTEGER NOT NULL,
    FOREIGN KEY (admin_id) REFERENCES User(id) ON DELETE CASCADE
);

CREATE TABLE Player (
    user_id INTEGER NOT NULL,
    tournament_id INTEGER NOT NULL,
    nickname TEXT,
    elo INTEGER DEFAULT 1000,
    rank INTEGER,
    PRIMARY KEY (user_id, tournament_id),
    FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE,
    FOREIGN KEY (tournament_id) REFERENCES Tournament(tournament_id) ON DELETE CASCADE
);

CREATE TABLE Match (
    match_id INTEGER PRIMARY KEY AUTOINCREMENT,
    player1 INTEGER NOT NULL,
    player2 INTEGER NOT NULL,
    winner INTEGER,
    tournament_id INTEGER NOT NULL,
    FOREIGN KEY (player1) REFERENCES Player(user_id) ON DELETE CASCADE,
    FOREIGN KEY (player2) REFERENCES Player(user_id) ON DELETE CASCADE,
    FOREIGN KEY (winner) REFERENCES Player(user_id) ON DELETE SET NULL,
    FOREIGN KEY (tournament_id) REFERENCES Tournament(tournament_id) ON DELETE CASCADE
);

-- =========================================
-- NOTIFICATIONS
-- =========================================

CREATE TABLE Notification (
    notif_id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT,
    owner_id INTEGER NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES User(id) ON DELETE CASCADE
);
INSERT INTO User (username, password, email) VALUES
('alice', '1234', 'alice@example.com'),
('bob', '5678', 'bob@example.com');

ALTER TABLE User ADD COLUMN avatar TEXT DEFAULT '/uploads/default.png';
