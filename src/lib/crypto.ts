import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
// In production, this should be a long random string in your .env file
// For now, I'll use a fallback, but you should add ENCRYPTION_KEY to .env
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "default_insecure_key_please_change_me_32char";
const IV_LENGTH = 16; // For AES, this is always 16

const getKey = () => {
    // Ensure key is 32 bytes
    return crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
};

export const encrypt = (text: string): string => {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString("hex") + ":" + encrypted.toString("hex");
};

export const decrypt = (text: string): string => {
    const textParts = text.split(":");
    const ivHex = textParts.shift();
    if (!ivHex) throw new Error("Invalid encrypted text format");
    const iv = Buffer.from(ivHex, "hex");
    const encryptedText = Buffer.from(textParts.join(":"), "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
};
