package com.example.Nagomi.repository;

import com.example.Nagomi.model.FriendRequest;
import com.example.Nagomi.model.RequestStatus;
import com.example.Nagomi.model.User;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.cloud.firestore.Firestore;
import org.springframework.stereotype.Repository;

import java.util.*;
import java.util.stream.Collectors;

@Repository
public class UserRepository extends FirestoreRepository<User> {
    public UserRepository(Firestore firestore, ObjectMapper mapper) {
        super(firestore, mapper, "users", User.class, User::getId, User::setId);
    }

    public Optional<User> findByUsername(String username) {
        return findWhere("username", username).stream().findFirst();
    }

    public boolean existsByUsername(String username) {
        return findByUsername(username).isPresent();
    }

    public List<Object[]> searchUsersWithMutualCount(Long myId, String keyword) {
        List<FriendRequest> accepted = new FriendRequestRepository(firestore, mapper).findByStatus(RequestStatus.ACCEPTED);
        Set<Long> myFriends = friendIds(myId, accepted);
        String prefix = keyword == null ? "" : keyword.toLowerCase(Locale.ROOT);
        return findAll().stream()
                .filter(user -> user.getId() != null && !user.getId().equals(myId))
                .filter(user -> user.getUsername() != null && user.getUsername().toLowerCase(Locale.ROOT).startsWith(prefix))
                .map(user -> new Object[]{user.getId(), user.getUsername(), user.getAvatarUrl(),
                        (long) friendIds(user.getId(), accepted).stream().filter(myFriends::contains).count()})
                .sorted(Comparator.<Object[]>comparingLong(row -> (Long) row[3]).reversed()
                        .thenComparing(row -> (String) row[1], String.CASE_INSENSITIVE_ORDER))
                .collect(Collectors.toList());
    }

    private Set<Long> friendIds(Long userId, List<FriendRequest> requests) {
        Set<Long> ids = new HashSet<>();
        for (FriendRequest request : requests) {
            if (request.getSender() == null || request.getReceiver() == null) continue;
            if (userId.equals(request.getSender().getId())) ids.add(request.getReceiver().getId());
            else if (userId.equals(request.getReceiver().getId())) ids.add(request.getSender().getId());
        }
        return ids;
    }
}
