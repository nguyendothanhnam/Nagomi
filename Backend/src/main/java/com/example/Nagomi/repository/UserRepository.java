package com.example.Nagomi.repository;

import com.example.Nagomi.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByUsername(String username);
    boolean existsByUsername(String username);
    @Query(value = "SELECT u.id, u.username, u.avatar_url as avatarUrl, " +
            "(SELECT COUNT(*) FROM friend_requests f1 " +
            " JOIN friend_requests f2 ON (f1.sender_id = f2.sender_id OR f1.sender_id = f2.receiver_id OR f1.receiver_id = f2.sender_id OR f1.receiver_id = f2.receiver_id) " +
            " WHERE f1.status = 'ACCEPTED' AND f2.status = 'ACCEPTED' " +
            " AND ((f1.sender_id = :myId OR f1.receiver_id = :myId)) " +
            " AND ((f2.sender_id = u.id OR f2.receiver_id = u.id)) " +
            " AND (f1.sender_id + f1.receiver_id - :myId) = (f2.sender_id + f2.receiver_id - u.id)) as mutualFriends " +
            "FROM users u " +
            "WHERE u.username LIKE CONCAT(:keyword, '%') AND u.id != :myId " +
            "ORDER BY mutualFriends DESC, u.username ASC", nativeQuery = true)
    List<Object[]> searchUsersWithMutualCount(@Param("myId") Long myId, @Param("keyword") String keyword);
}