CREATE TABLE CALENDAR_TodayMessages (
    id NUMBER PRIMARY KEY,
    user_id VARCHAR2(32) NOT NULL,
    channel_id VARCHAR2(32) NOT NULL,
    message_id VARCHAR2(32) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE seq_today_msgs_id START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE TRIGGER trg_today_msgs_id
BEFORE INSERT ON CALENDAR_TodayMessages
FOR EACH ROW
BEGIN
  SELECT seq_today_msgs_id.NEXTVAL INTO :new.id FROM dual;
END;
/

CREATE UNIQUE INDEX idx_today_msgs_user_chan ON CALENDAR_TodayMessages (user_id, channel_id);
