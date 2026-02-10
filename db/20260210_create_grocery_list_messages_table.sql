CREATE TABLE CALENDAR_GroceryListMessages (
  channel_id VARCHAR2(30) NOT NULL,
  message_id VARCHAR2(30) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_grocery_list_msgs_channel
  ON CALENDAR_GroceryListMessages (channel_id);
