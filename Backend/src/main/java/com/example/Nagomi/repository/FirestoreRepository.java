package com.example.Nagomi.repository;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.example.Nagomi.model.Channel;
import com.example.Nagomi.model.ChannelMessage;
import com.example.Nagomi.model.FriendRequest;
import com.example.Nagomi.model.Server;
import com.example.Nagomi.model.ServerInvitation;
import com.example.Nagomi.model.ServerMember;
import com.example.Nagomi.model.User;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.Query;
import com.google.cloud.firestore.QueryDocumentSnapshot;
import com.google.cloud.firestore.WriteResult;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ExecutionException;
import java.util.function.BiConsumer;
import java.util.function.Function;

/** Synchronous adapter used by the existing REST controllers over Firestore. */
public abstract class FirestoreRepository<T> {
    protected final Firestore firestore;
    protected final ObjectMapper mapper;
    private final String collectionName;
    private final Function<T, Long> idGetter;
    private final BiConsumer<T, Long> idSetter;
    private final Class<T> modelType;

    protected FirestoreRepository(Firestore firestore, ObjectMapper mapper, String collectionName,
                                  Class<T> modelType, Function<T, Long> idGetter,
                                  BiConsumer<T, Long> idSetter) {
        this.firestore = firestore;
        this.mapper = mapper;
        this.collectionName = collectionName;
        this.modelType = modelType;
        this.idGetter = idGetter;
        this.idSetter = idSetter;
    }

    public T save(T entity) {
        Long id = idGetter.apply(entity);
        if (id == null) {
            id = nextId();
            idSetter.accept(entity, id);
        }
        Map<String, Object> data = toDocument(entity);
        await(firestore.collection(collectionName).document(id.toString()).set(data));
        return entity;
    }

    private Map<String, Object> toDocument(T entity) {
        Map<String, Object> data = mapper.convertValue(entity, new TypeReference<Map<String, Object>>() {});
        if (entity instanceof Server server) {
            data.put("owner", userReference(server.getOwner()));
            data.put("members", server.getMembers().stream().map(this::userReference).toList());
        } else if (entity instanceof Channel channel) {
            data.put("server", serverReference(channel.getServer()));
        } else if (entity instanceof ChannelMessage message) {
            data.put("sender", userReference(message.getSender()));
            data.put("channel", channelReference(message.getChannel()));
        } else if (entity instanceof FriendRequest request) {
            data.put("sender", userReference(request.getSender()));
            data.put("receiver", userReference(request.getReceiver()));
        } else if (entity instanceof ServerMember member) {
            data.put("server", serverReference(member.getServer()));
            data.put("user", userReference(member.getUser()));
        } else if (entity instanceof ServerInvitation invitation) {
            data.put("server", serverReference(invitation.getServer()));
            data.put("inviter", userReference(invitation.getInviter()));
            data.put("receiver", userReference(invitation.getReceiver()));
        }
        return data;
    }

    private Map<String, Object> userReference(User user) {
        if (user == null) return null;
        Map<String, Object> ref = new java.util.HashMap<>();
        ref.put("id", user.getId());
        ref.put("username", user.getUsername());
        ref.put("email", user.getEmail());
        ref.put("avatarUrl", user.getAvatarUrl());
        ref.put("status", user.getStatus());
        return ref;
    }

    private Map<String, Object> serverReference(Server server) {
        if (server == null) return null;
        Map<String, Object> ref = new java.util.HashMap<>();
        ref.put("id", server.getId());
        ref.put("name", server.getName());
        ref.put("iconUrl", server.getIconUrl());
        ref.put("inviteCode", server.getInviteCode());
        ref.put("owner", userReference(server.getOwner()));
        return ref;
    }

    private Map<String, Object> channelReference(Channel channel) {
        if (channel == null) return null;
        Map<String, Object> ref = new java.util.HashMap<>();
        ref.put("id", channel.getId());
        ref.put("name", channel.getName());
        ref.put("type", channel.getType());
        ref.put("server", serverReference(channel.getServer()));
        return ref;
    }

    public Optional<T> findById(Long id) {
        if (id == null) return Optional.empty();
        DocumentSnapshot snapshot = await(firestore.collection(collectionName).document(id.toString()).get());
        return snapshot.exists() ? Optional.of(fromSnapshot(snapshot)) : Optional.empty();
    }

    public boolean existsById(Long id) {
        return findById(id).isPresent();
    }

    public List<T> findAll() {
        List<T> values = new ArrayList<>();
        for (QueryDocumentSnapshot snapshot : await(firestore.collection(collectionName).get()).getDocuments()) {
            values.add(fromSnapshot(snapshot));
        }
        return values;
    }

    public List<T> findWhere(String field, Object value) {
        Query query = firestore.collection(collectionName).whereEqualTo(field, value);
        List<T> values = new ArrayList<>();
        for (QueryDocumentSnapshot snapshot : await(query.get()).getDocuments()) {
            values.add(fromSnapshot(snapshot));
        }
        return values;
    }

    public void deleteById(Long id) {
        if (id != null) await(firestore.collection(collectionName).document(id.toString()).delete());
    }

    public void delete(T entity) {
        deleteById(idGetter.apply(entity));
    }

    public void deleteAll(Iterable<T> entities) {
        for (T entity : entities) delete(entity);
    }

    private T fromSnapshot(DocumentSnapshot snapshot) {
        T value = mapper.convertValue(snapshot.getData(), modelType);
        idSetter.accept(value, Long.valueOf(snapshot.getId()));
        return value;
    }

    private Long nextId() {
        return await(firestore.runTransaction(transaction -> {
            var counterRef = firestore.collection("_metadata").document(collectionName);
            var counter = transaction.get(counterRef).get();
            Long current = counter.exists() ? counter.getLong("value") : 0L;
            long next = (current == null ? 0L : current) + 1L;
            transaction.set(counterRef, java.util.Map.of("value", next));
            return next;
        }));
    }

    protected <R> R await(com.google.api.core.ApiFuture<R> future) {
        try {
            return future.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while accessing Firestore", e);
        } catch (ExecutionException e) {
            throw new IllegalStateException("Firestore request failed", e.getCause());
        }
    }
}
