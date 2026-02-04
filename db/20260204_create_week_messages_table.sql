CREATE TABLE CALENDAR_WeekMessages (
    id NUMBER PRIMARY KEY,
    user_id VARCHAR2(32) NOT NULL,
    channel_id VARCHAR2(32) NOT NULL,
    message_id VARCHAR2(32) NOT NULL,
    sort_order NUMBER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE seq_week_msgs_id START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE TRIGGER trg_week_msgs_id
BEFORE INSERT ON CALENDAR_WeekMessages
FOR EACH ROW
BEGIN
  SELECT seq_week_msgs_id.NEXTVAL INTO :new.id FROM dual;
END;
/

CREATE UNIQUE INDEX idx_week_msgs_user_chan_sort
ON CALENDAR_WeekMessages (user_id, channel_id, sort_order);
