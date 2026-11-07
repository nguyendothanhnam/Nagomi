package com.example.Nagomi.service;

import com.example.Nagomi.dto.response.LoginResponse;
import com.example.Nagomi.model.User;
import com.example.Nagomi.util.JwtUtils;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Short-lived, one-use browser login approvals. */
@Service
public class QrLoginService {
    private static final Duration SESSION_LIFETIME = Duration.ofMinutes(2);
    private static final Duration RETAIN_AFTER_EXPIRY = Duration.ofMinutes(1);
    private static final SecureRandom RANDOM = new SecureRandom();
    private final Map<String, LoginSession> sessions = new ConcurrentHashMap<>();

    public record StartResponse(String sessionId, String pollSecret, String qrPayload, Instant expiresAt) {}
    public record StatusResponse(String status, String username, String avatarUrl, LoginResponse login) {}

    public StartResponse start() {
        cleanupExpired();
        String sessionId = randomToken();
        String pollSecret = randomToken();
        Instant expiresAt = Instant.now().plus(SESSION_LIFETIME);
        sessions.put(sessionId, new LoginSession(hash(pollSecret), expiresAt));
        // Only the short-lived session id is placed in the QR. The polling secret stays in the browser.
        return new StartResponse(sessionId, pollSecret, "nagomi-auth:" + sessionId, expiresAt);
    }

    public boolean approve(String sessionId, User user) {
        LoginSession session = sessions.get(sessionId);
        if (session == null) return false;
        synchronized (session) {
            if (session.expireIfNeeded() || session.state != State.PENDING) return false;
            session.login = new LoginResponse(user.getId(), user.getUsername(), user.getEmail(), user.getAvatarUrl(),
                    JwtUtils.generateJwtToken(user.getId(), user.getUsername()));
            session.state = State.APPROVED;
            return true;
        }
    }

    public boolean deny(String sessionId) {
        LoginSession session = sessions.get(sessionId);
        if (session == null) return false;
        synchronized (session) {
            if (session.expireIfNeeded() || session.state != State.PENDING) return false;
            session.state = State.DENIED;
            return true;
        }
    }

    public StatusResponse status(String sessionId, String pollSecret) {
        LoginSession session = sessions.get(sessionId);
        if (session == null || pollSecret == null || !MessageDigest.isEqual(session.pollSecretHash, hash(pollSecret))) {
            return null;
        }
        synchronized (session) {
            if (session.expireIfNeeded()) return new StatusResponse("EXPIRED", null, null, null);
            if (session.state == State.APPROVED) {
                // The JWT is returned once; a lost response requires starting a new QR session.
                session.state = State.CONSUMED;
                return new StatusResponse("APPROVED", session.login.getUsername(), session.login.getAvatarUrl(), session.login);
            }
            return new StatusResponse(session.state.name(), null, null, null);
        }
    }

    private void cleanupExpired() {
        Instant cutoff = Instant.now().minus(RETAIN_AFTER_EXPIRY);
        sessions.entrySet().removeIf(entry -> entry.getValue().expiresAt.isBefore(cutoff));
    }

    private static String randomToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static byte[] hash(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private enum State { PENDING, APPROVED, DENIED, CONSUMED }

    private static final class LoginSession {
        private final byte[] pollSecretHash;
        private final Instant expiresAt;
        private State state = State.PENDING;
        private LoginResponse login;

        private LoginSession(byte[] pollSecretHash, Instant expiresAt) {
            this.pollSecretHash = pollSecretHash;
            this.expiresAt = expiresAt;
        }

        private boolean expireIfNeeded() {
            if (Instant.now().isBefore(expiresAt)) return false;
            state = State.CONSUMED;
            login = null;
            return true;
        }
    }
}
