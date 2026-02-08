CREATE TABLE CALENDAR_HelpWantedRequests (
    id NUMBER PRIMARY KEY,
    requester_user_id VARCHAR2(32) NOT NULL,
    role_ids VARCHAR2(1000),
    description VARCHAR2(2000) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE seq_help_wanted_requests_id START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE TRIGGER trg_help_wanted_requests_id
BEFORE INSERT ON CALENDAR_HelpWantedRequests
FOR EACH ROW
BEGIN
  SELECT seq_help_wanted_requests_id.NEXTVAL INTO :new.id FROM dual;
END;
/

CREATE INDEX idx_help_wanted_requests_created_at
ON CALENDAR_HelpWantedRequests (created_at);
