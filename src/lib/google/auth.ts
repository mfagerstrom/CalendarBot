import { google } from "googleapis";
import { GOOGLE_CONFIG } from "../../config/google.js";

export const getOAuth2Client = () => {
  return new google.auth.OAuth2(
    GOOGLE_CONFIG.clientId,
    GOOGLE_CONFIG.clientSecret,
    GOOGLE_CONFIG.redirectUri
  );
};

export const getAuthUrl = (state: string) => {
  const oauth2Client = getOAuth2Client();

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: GOOGLE_CONFIG.scopes,
    state: state,
    prompt: "consent", // Force consent to ensure we get a refresh token
  });
};
