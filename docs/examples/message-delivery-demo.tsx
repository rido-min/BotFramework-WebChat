/**
 * BotFramework-WebChat Message Delivery Architecture Demo
 * 
 * This example demonstrates the key components and flow of message delivery
 * in the Web Chat system. It shows how messages flow from user input through
 * the Redux store, sagas, and back to the UI.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { call, put, take, takeEvery, select, race, delay } from 'redux-saga/effects';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface WebChatActivity {
  id?: string;
  type: 'message' | 'typing' | 'event';
  text?: string;
  from: {
    id: string;
    name?: string;
    role: 'user' | 'bot';
  };
  timestamp: string;
  channelData?: {
    clientActivityID?: string;
    'webchat:send-status'?: 'sending' | 'sent' | 'failed';
  };
  replyToId?: string;
}

interface WebChatState {
  activities: WebChatActivity[];
  connectionStatus: number;
  sendBox: {
    text: string;
  };
}

// ============================================================================
// ACTION CREATORS
// ============================================================================

// Outgoing message actions
const POST_ACTIVITY = 'DIRECT_LINE/POST_ACTIVITY';
const POST_ACTIVITY_PENDING = 'DIRECT_LINE/POST_ACTIVITY_PENDING';
const POST_ACTIVITY_FULFILLED = 'DIRECT_LINE/POST_ACTIVITY_FULFILLED';
const POST_ACTIVITY_REJECTED = 'DIRECT_LINE/POST_ACTIVITY_REJECTED';

// Incoming message actions
const QUEUE_INCOMING_ACTIVITY = 'DIRECT_LINE/QUEUE_INCOMING_ACTIVITY';
const INCOMING_ACTIVITY = 'DIRECT_LINE/INCOMING_ACTIVITY';

// Connection actions
const CONNECT = 'DIRECT_LINE/CONNECT';
const UPDATE_CONNECTION_STATUS = 'DIRECT_LINE/UPDATE_CONNECTION_STATUS';

export const postActivity = (activity: WebChatActivity, method = 'keyboard') => ({
  type: POST_ACTIVITY,
  payload: { activity },
  meta: { method }
});

export const queueIncomingActivity = (activity: WebChatActivity) => ({
  type: QUEUE_INCOMING_ACTIVITY,
  payload: { activity }
});

export const incomingActivity = (activity: WebChatActivity) => ({
  type: INCOMING_ACTIVITY,
  payload: { activity }
});

// ============================================================================
// SAGA EFFECTS (SIDE EFFECT HANDLERS)
// ============================================================================

/**
 * Handles outgoing message delivery
 * This saga manages the complete lifecycle of sending a message:
 * 1. Add message to transcript with "sending" status
 * 2. Send to bot service via Direct Line
 * 3. Wait for echo back confirmation
 * 4. Update status to "sent" or "failed"
 */
function* postActivitySaga(action: any) {
  const { payload: { activity }, meta: { method } } = action;
  
  // Generate unique ID for tracking this message
  const clientActivityID = `client_${Date.now()}_${Math.random()}`;
  
  // Get current user info from state
  const userID: string = yield select((state: any) => state.userID || 'user');
  const username: string = yield select((state: any) => state.username || 'User');
  
  // Prepare the outgoing activity
  const outgoingActivity: WebChatActivity = {
    ...activity,
    from: {
      id: userID,
      name: username,
      role: 'user'
    },
    timestamp: new Date().toISOString(),
    channelData: {
      clientActivityID,
      'webchat:send-status': 'sending'
    }
  };

  const meta = { clientActivityID, method };

  try {
    // 1. Add message to transcript with "sending" status
    yield put({
      type: POST_ACTIVITY_PENDING,
      meta,
      payload: { activity: outgoingActivity }
    });

    // 2. Simulate sending to Direct Line service
    // In real implementation, this would be: yield call(directLine.postActivity, outgoingActivity)
    console.log('🚀 Sending message to bot service:', outgoingActivity);
    
    // Simulate network delay
    yield delay(500 + Math.random() * 1000);
    
    // Simulate occasional failures (10% chance)
    if (Math.random() < 0.1) {
      throw new Error('Network timeout');
    }

    // 3. Wait for echo back from service
    // This confirms the message was received and processed
    const echoBack: WebChatActivity = {
      ...outgoingActivity,
      id: `echo_${clientActivityID}`, // Server assigns real ID
      channelData: {
        ...outgoingActivity.channelData,
        'webchat:send-status': 'sent'
      }
    };

    // 4. Update message status to "sent"
    yield put({
      type: POST_ACTIVITY_FULFILLED,
      meta,
      payload: { activity: echoBack }
    });

    console.log('✅ Message sent successfully:', echoBack);

    // 5. Simulate bot response after a delay
    yield delay(1000 + Math.random() * 2000);
    yield call(simulateBotResponse, echoBack);

  } catch (error) {
    // Handle send failure
    console.error('❌ Failed to send message:', error);
    
    yield put({
      type: POST_ACTIVITY_REJECTED,
      meta,
      payload: error,
      error: true
    });
  }
}

/**
 * Simulates a bot response to demonstrate incoming message flow
 */
function* simulateBotResponse(userActivity: WebChatActivity) {
  const botResponses = [
    "I understand you said: " + userActivity.text,
    "That's interesting! Tell me more.",
    "I'm here to help. What else would you like to know?",
    "Thanks for your message. Let me think about that...",
  ];

  const responseText = botResponses[Math.floor(Math.random() * botResponses.length)];

  const botActivity: WebChatActivity = {
    id: `bot_${Date.now()}_${Math.random()}`,
    type: 'message',
    text: responseText,
    from: {
      id: 'bot',
      name: 'Demo Bot',
      role: 'bot'
    },
    timestamp: new Date().toISOString(),
    replyToId: userActivity.id // This creates a threaded conversation
  };

  // Queue the incoming bot message
  yield put(queueIncomingActivity(botActivity));
}

/**
 * Handles incoming message processing and ordering
 * This saga ensures messages appear in the correct order,
 * especially for threaded conversations with replyToId
 */
function* queueIncomingActivitySaga(action: any) {
  const { payload: { activity } } = action;
  
  console.log('📥 Processing incoming activity:', activity);

  // Handle message ordering for replies
  if (activity.replyToId) {
    console.log(`⏳ Waiting for parent message ${activity.replyToId}...`);
    
    // Wait for the message this is replying to (up to 5 seconds)
    const result = yield race({
      found: call(waitForActivityId, activity.replyToId),
      timeout: delay(5000)
    });

    if ('timeout' in result) {
      console.warn(`⚠️ Timeout waiting for activity ${activity.replyToId}`);
    } else {
      console.log(`✅ Found parent message ${activity.replyToId}`);
    }
  }

  // Add the activity to the transcript
  yield put(incomingActivity(activity));
  
  console.log('✅ Added to transcript:', activity);
}

/**
 * Helper function to wait for a specific activity to appear in the transcript
 */
function* waitForActivityId(activityId: string) {
  while (true) {
    const activities: WebChatActivity[] = yield select((state: WebChatState) => state.activities);
    
    if (activities.some(activity => activity.id === activityId)) {
      return true; // Found the activity
    }
    
    // Wait for the next incoming activity
    yield take(INCOMING_ACTIVITY);
  }
}

/**
 * Root saga that starts all message-related sagas
 */
export function* messagingSaga() {
  yield takeEvery(POST_ACTIVITY, postActivitySaga);
  yield takeEvery(QUEUE_INCOMING_ACTIVITY, queueIncomingActivitySaga);
}

// ============================================================================
// REDUCERS (STATE MANAGEMENT)
// ============================================================================

const initialState: WebChatState = {
  activities: [],
  connectionStatus: 2, // ONLINE
  sendBox: {
    text: ''
  }
};

export function activitiesReducer(state = initialState.activities, action: any): WebChatActivity[] {
  switch (action.type) {
    case POST_ACTIVITY_PENDING:
      // Add new outgoing message with "sending" status
      return [
        ...state,
        action.payload.activity
      ];

    case POST_ACTIVITY_FULFILLED:
      // Update message status to "sent"
      return state.map(activity =>
        activity.channelData?.clientActivityID === action.meta.clientActivityID
          ? action.payload.activity
          : activity
      );

    case POST_ACTIVITY_REJECTED:
      // Update message status to "failed"
      return state.map(activity =>
        activity.channelData?.clientActivityID === action.meta.clientActivityID
          ? {
              ...activity,
              channelData: {
                ...activity.channelData,
                'webchat:send-status': 'failed'
              }
            }
          : activity
      );

    case INCOMING_ACTIVITY:
      // Add incoming message (from bot)
      const { activity } = action.payload;
      
      // Prevent duplicates
      if (state.some(existing => existing.id === activity.id)) {
        return state;
      }
      
      return [...state, activity];

    default:
      return state;
  }
}

// ============================================================================
// REACT COMPONENTS (UI LAYER)
// ============================================================================

/**
 * Custom hook to access activities from Redux store
 */
const useActivities = () => {
  return useSelector((state: any) => state.activities || []);
};

/**
 * Send box component for user input
 */
const SendBox: React.FC = () => {
  const [text, setText] = useState('');
  const dispatch = useDispatch();

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    
    if (!text.trim()) return;

    // Create message activity
    const activity: WebChatActivity = {
      type: 'message',
      text: text.trim(),
      from: { id: 'user', role: 'user' },
      timestamp: new Date().toISOString()
    };

    // Dispatch action to send message
    dispatch(postActivity(activity));
    
    // Clear input
    setText('');
  }, [text, dispatch]);

  return (
    <form onSubmit={handleSubmit} style={{ padding: '10px', borderTop: '1px solid #ccc' }}>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a message..."
        style={{ 
          width: '80%', 
          padding: '10px', 
          marginRight: '10px',
          border: '1px solid #ddd',
          borderRadius: '4px'
        }}
      />
      <button 
        type="submit"
        style={{
          padding: '10px 20px',
          backgroundColor: '#0078d4',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer'
        }}
      >
        Send
      </button>
    </form>
  );
};

/**
 * Message component that displays individual activities
 */
const ActivityRenderer: React.FC<{ activity: WebChatActivity }> = ({ activity }) => {
  const isFromUser = activity.from.role === 'user';
  const sendStatus = activity.channelData?.['webchat:send-status'];

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isFromUser ? 'flex-end' : 'flex-start',
        margin: '10px',
      }}
    >
      <div
        style={{
          maxWidth: '70%',
          padding: '10px',
          borderRadius: '10px',
          backgroundColor: isFromUser ? '#0078d4' : '#f1f1f1',
          color: isFromUser ? 'white' : 'black',
        }}
      >
        <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '5px' }}>
          {activity.from.name || activity.from.role}
          {sendStatus && (
            <span style={{ marginLeft: '10px' }}>
              {sendStatus === 'sending' && '⏳'}
              {sendStatus === 'sent' && '✅'}
              {sendStatus === 'failed' && '❌'}
            </span>
          )}
        </div>
        <div>{activity.text}</div>
        <div style={{ fontSize: '10px', opacity: 0.5, marginTop: '5px' }}>
          {new Date(activity.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
};

/**
 * Main transcript component that displays the conversation
 */
const Transcript: React.FC = () => {
  const activities = useActivities();

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    const container = document.getElementById('transcript-container');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [activities]);

  return (
    <div
      id="transcript-container"
      style={{
        height: '400px',
        overflowY: 'auto',
        border: '1px solid #ccc',
        backgroundColor: '#fafafa'
      }}
    >
      {activities.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
          Start a conversation by typing a message below
        </div>
      ) : (
        activities.map((activity, index) => (
          <ActivityRenderer 
            key={activity.id || activity.channelData?.clientActivityID || index}
            activity={activity}
          />
        ))
      )}
    </div>
  );
};

/**
 * Main Web Chat demo component
 */
export const WebChatDemo: React.FC = () => {
  return (
    <div style={{ width: '500px', margin: '20px auto', fontFamily: 'Arial, sans-serif' }}>
      <h2>BotFramework-WebChat Architecture Demo</h2>
      <p style={{ fontSize: '14px', color: '#666' }}>
        This demo shows the message delivery flow. Type a message to see:
        <br />• Outgoing message processing (user → bot)
        <br />• Incoming message handling (bot → user)
        <br />• Message status tracking and ordering
      </p>
      
      <Transcript />
      <SendBox />
      
      <div style={{ marginTop: '20px', fontSize: '12px', color: '#666' }}>
        <strong>Architecture Flow:</strong>
        <br />1. User types → SendBox component
        <br />2. postActivity action → Redux dispatch
        <br />3. postActivitySaga → Message processing
        <br />4. Direct Line API → Bot service communication
        <br />5. Echo back → Status confirmation
        <br />6. Bot response → queueIncomingActivitySaga
        <br />7. State update → UI re-render
      </div>
    </div>
  );
};

export default WebChatDemo;