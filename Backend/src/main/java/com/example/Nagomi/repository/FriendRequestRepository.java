package com.example.Nagomi.repository;

import com.example.Nagomi.model.FriendRequest;
import com.example.Nagomi.model.RequestStatus;
import com.example.Nagomi.model.User;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.cloud.firestore.Firestore;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.HashMap;
import java.util.Map;

@Repository
public class FriendRequestRepository extends FirestoreRepository<FriendRequest> {
    public FriendRequestRepository(Firestore firestore, ObjectMapper mapper) {
        super(firestore, mapper, "friend_requests", FriendRequest.class, FriendRequest::getId, FriendRequest::setId);
    }

    public boolean existsBySenderAndReceiverAndStatus(User sender, User receiver, RequestStatus status) {
        return findBySenderAndStatus(sender, status).stream()
                .anyMatch(r -> r.getReceiver() != null && receiver.getId().equals(r.getReceiver().getId()));
    }

    public List<FriendRequest> findBySenderAndStatus(User sender, RequestStatus status) {
        return findWhere("sender.id", sender.getId()).stream().filter(r -> r.getStatus() == status).toList();
    }

    public List<FriendRequest> findByReceiverAndStatus(User receiver, RequestStatus status) {
        return findWhere("receiver.id", receiver.getId()).stream().filter(r -> r.getStatus() == status).toList();
    }

    public List<FriendRequest> findByStatus(RequestStatus status) {
        return findWhere("status", status.name());
    }

    /** Returns the current accepted or pending relationship for every user related to userId. */
    public Map<Long, FriendRequest> findActiveRelationships(Long userId) {
        Map<Long, FriendRequest> relationships = new HashMap<>();
        for (RequestStatus status : List.of(RequestStatus.ACCEPTED, RequestStatus.PENDING)) {
            for (FriendRequest request : findByStatus(status)) {
                if (request.getSender() == null || request.getReceiver() == null || request.getStatus() == null) continue;
                Long otherUserId;
                if (userId.equals(request.getSender().getId())) otherUserId = request.getReceiver().getId();
                else if (userId.equals(request.getReceiver().getId())) otherUserId = request.getSender().getId();
                else continue;

                if (otherUserId == null || (request.getStatus() != RequestStatus.ACCEPTED
                        && request.getStatus() != RequestStatus.PENDING)) continue;

                FriendRequest existing = relationships.get(otherUserId);
                int newPriority = relationshipPriority(request, userId);
                int existingPriority = existing == null ? -1 : relationshipPriority(existing, userId);
                if (newPriority > existingPriority) {
                    relationships.put(otherUserId, request);
                }
            }
        }
        return relationships;
    }

    private int relationshipPriority(FriendRequest request, Long userId) {
        if (request.getStatus() == RequestStatus.ACCEPTED) return 3;
        return userId.equals(request.getReceiver().getId()) ? 2 : 1;
    }

    public List<FriendRequest> findAllAcceptedFriendships(Long userId) {
        return findByStatus(RequestStatus.ACCEPTED).stream()
                .filter(r -> r.getSender() != null && r.getReceiver() != null
                        && (userId.equals(r.getSender().getId()) || userId.equals(r.getReceiver().getId())))
                .toList();
    }

    public FriendRequest findFriendship(Long userId, Long friendId) {
        return findByStatus(RequestStatus.ACCEPTED).stream()
                .filter(r -> r.getSender() != null && r.getReceiver() != null
                        && ((userId.equals(r.getSender().getId()) && friendId.equals(r.getReceiver().getId()))
                        || (friendId.equals(r.getSender().getId()) && userId.equals(r.getReceiver().getId()))))
                .findFirst().orElse(null);
    }
}
