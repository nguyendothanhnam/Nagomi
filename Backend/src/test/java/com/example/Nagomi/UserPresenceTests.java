package com.example.Nagomi;

import com.example.Nagomi.controller.UserController;
import com.example.Nagomi.model.FriendRequest;
import com.example.Nagomi.model.User;
import com.example.Nagomi.service.VoiceService;
import com.example.Nagomi.util.JwtUtils;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import com.example.Nagomi.repository.FriendRequestRepository;
import com.example.Nagomi.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.List;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class UserPresenceTests {
    @Test
    void friendsReadCurrentStatusInsteadOfEmbeddedSnapshot() {
        UserController controller = new UserController();
        FriendRequestRepository relations = mock(FriendRequestRepository.class);
        UserRepository users = mock(UserRepository.class);
        ReflectionTestUtils.setField(controller, "friendRequestRepository", relations);
        ReflectionTestUtils.setField(controller, "userRepo", users);
        ReflectionTestUtils.setField(controller, "voiceService", new VoiceService());
        User me = new User(); me.setId(1L);
        User stale = new User(); stale.setId(2L); stale.setStatus("OFFLINE");
        User latest = new User(); latest.setId(2L); latest.setStatus("ONLINE"); latest.setPassword("secret");
        latest.setUsername("Nguyễn Nam");
        FriendRequest relation = new FriendRequest(); relation.setSender(me); relation.setReceiver(stale);
        when(relations.findAllAcceptedFriendships(1L)).thenReturn(List.of(relation));
        when(users.findById(2L)).thenReturn(Optional.of(latest));
        List<User> result = controller.getFriendsList(1L);
        assertEquals(1, result.size());
        assertEquals("ONLINE", result.getFirst().getStatus());
        assertEquals("Nguyễn Nam", result.getFirst().getUsername());
        assertNull(result.getFirst().getPassword());
        latest.setStatus("OFFLINE");
        assertEquals("OFFLINE", controller.getFriendsList(1L).getFirst().getStatus());
    }

    @Test
    void deletedFriendsAreNotReturnedFromOldRelations() {
        UserController controller = new UserController();
        FriendRequestRepository relations = mock(FriendRequestRepository.class);
        UserRepository users = mock(UserRepository.class);
        ReflectionTestUtils.setField(controller, "friendRequestRepository", relations);
        ReflectionTestUtils.setField(controller, "userRepo", users);
        ReflectionTestUtils.setField(controller, "voiceService", new VoiceService());
        User me = new User(); me.setId(1L);
        User deleted = new User(); deleted.setId(2L);
        FriendRequest relation = new FriendRequest(); relation.setSender(deleted); relation.setReceiver(me);
        when(relations.findAllAcceptedFriendships(1L)).thenReturn(List.of(relation));
        when(users.findById(2L)).thenReturn(Optional.empty());
        assertTrue(controller.getFriendsList(1L).isEmpty());
    }
    @Test
    void backgroundOfflineCannotOverrideActiveVoiceSession() {
        UserController controller = new UserController();
        UserRepository users = mock(UserRepository.class);
        VoiceService voice = new VoiceService();
        SimpMessagingTemplate messages = mock(SimpMessagingTemplate.class);
        ReflectionTestUtils.setField(controller, "userRepo", users);
        ReflectionTestUtils.setField(controller, "voiceService", voice);
        ReflectionTestUtils.setField(controller, "messagingTemplate", messages);
        User member = new User(); member.setId(1L); member.setUsername("voice-user"); member.setStatus("ONLINE");
        when(users.findById(1L)).thenReturn(Optional.of(member));
        voice.joinChannel(101L, member);
        String authorization = "Bearer " + JwtUtils.generateJwtToken(1L, "voice-user");
        assertEquals(200, controller.updateUserStatus(1L, "OFFLINE", authorization).getStatusCode().value());
        assertEquals("ONLINE", member.getStatus());
        voice.leaveChannel(101L, 1L);
        controller.updateUserStatus(1L, "OFFLINE", authorization);
        assertEquals("OFFLINE", member.getStatus());
    }
}
