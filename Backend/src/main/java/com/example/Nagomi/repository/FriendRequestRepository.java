package com.example.Nagomi.repository;

import com.example.Nagomi.model.FriendRequest;
import com.example.Nagomi.model.RequestStatus;
import com.example.Nagomi.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import java.util.List;


@Repository
public interface FriendRequestRepository extends JpaRepository<FriendRequest, Long> {

    // Kiểm tra tồn tại lời mời với trạng thái cụ thể
    boolean existsBySenderAndReceiverAndStatus(User sender, User receiver, RequestStatus status);

    // Tìm danh sách theo người gửi/nhận và trạng thái
    List<FriendRequest> findBySenderAndStatus(User sender, RequestStatus status);
    List<FriendRequest> findByReceiverAndStatus(User receiver, RequestStatus status);

    // Hàm tìm mối quan hệ bạn bè để hủy kết bạn (đã được ACCEPTED)
    @Query("SELECT f FROM FriendRequest f WHERE f.status = com.example.Nagomi.model.RequestStatus.ACCEPTED " +
            "AND (f.sender.id = :userId OR f.receiver.id = :userId)")
    List<FriendRequest> findAllAcceptedFriendships(@Param("userId") Long userId);

    @Query("SELECT f FROM FriendRequest f WHERE f.status = com.example.Nagomi.model.RequestStatus.ACCEPTED " +
            "AND ((f.sender.id = :u1 AND f.receiver.id = :u2) OR (f.sender.id = :u2 AND f.receiver.id = :u1))")
    FriendRequest findFriendship(@Param("u1") Long userId, @Param("u2") Long friendId);
}
