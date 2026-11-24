-- Run once against the coolgames database.
-- One row per game a user has put in a list. The primary key means a game can be
-- in only one list per user: saving it again moves it to the new list.

CREATE TABLE IF NOT EXISTS user_games (
  user_id    INT NOT NULL,
  igdb_id    INT NOT NULL,
  game_name  VARCHAR(255) NOT NULL,
  cover_url  VARCHAR(500),
  list_name  ENUM('backlog', 'playing', 'completed', 'wishlist') NOT NULL,
  added_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, igdb_id)
  -- When the users table exists, add:
  -- , FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
