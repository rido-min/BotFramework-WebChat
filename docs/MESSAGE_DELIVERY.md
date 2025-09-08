# Message Delivery in BotFramework-WebChat

This document provides a detailed explanation of how messages are delivered to users in the BotFramework-WebChat system.

## Overview

Message delivery in Web Chat is a bidirectional process that handles both outgoing messages (from user to bot) and incoming messages (from bot to user). The system is built on a robust architecture that ensures reliable message delivery, proper ordering, and real-time updates.

## Key Components in Message Delivery

### 1. Direct Line Connection & WebSocket Layer
- **Protocol**: HTTP/WebSocket-based communication with Bot Framework
- **Endpoints**: `/conversations/{conversationId}/activities`
- **Transport**: WebSocket for real-time incoming messages, HTTP for outgoing messages
- **WebSocket URL**: `wss://directline.botframework.com/v3/directline/conversations/{conversationId}/stream`
- **Observable Interface**: DirectLineJS exposes `activity$` and `connectionStatus$` streams

### 2. Redux State Management
- **Store**: Centralized state containing all activities/messages
- **Actions**: State change events (INCOMING_ACTIVITY, POST_ACTIVITY, etc.)
- **Reducers**: Pure functions that update state based on actions

### 3. Saga Middleware
- **Side Effects**: Handles async operations like network calls
- **Business Logic**: Message ordering, retry logic, connection management
- **Event Coordination**: Manages complex workflows between multiple actions
- **WebSocket Management**: Handles subscription lifecycle and reconnection logic

## Outgoing Message Flow (User → Bot)

### Step-by-Step Process

1. **User Input Capture**
   ```typescript
   // SendBox component captures user input
   const handleSubmit = useCallback((text) => {
     // Create message activity
     const activity = {
       type: 'message',
       text: text,
       timestamp: new Date().toISOString()
     };
     
     // Dispatch action to send message
     dispatch(postActivity(activity));
   }, [dispatch]);
   ```

2. **Action Dispatch**
   ```typescript
   // postActivity action creator
   function postActivity(activity: WebChatActivity): PostActivityAction {
     return {
       type: 'DIRECT_LINE/POST_ACTIVITY',
       payload: { activity },
       meta: { method: 'keyboard' } // tracking input method
     };
   }
   ```

3. **Saga Processing** (`postActivitySaga.ts`)
   ```typescript
   function* postActivity(directLine, userID, username, action) {
     // Generate unique client ID for tracking
     const clientActivityID = uniqueID();
     
     // Prepare outgoing activity
     const outgoingActivity = {
       ...activity,
       channelData: { clientActivityID },
       from: { id: userID, name: username, role: 'user' },
       locale: yield select(languageSelector),
       localTimestamp: new Date().toISOString()
     };
     
     // Dispatch PENDING state
     yield put({
       type: 'DIRECT_LINE/POST_ACTIVITY_PENDING',
       meta: { clientActivityID },
       payload: { activity: outgoingActivity }
     });
     
     try {
       // Send to Direct Line service
       const result = yield call(
         directLine.postActivity,
         outgoingActivity
       );
       
       // Wait for echo back (confirmation from bot service)
       const echoBack = yield waitForEchoBack(clientActivityID);
       
       // Dispatch SUCCESS state
       yield put({
         type: 'DIRECT_LINE/POST_ACTIVITY_FULFILLED',
         meta: { clientActivityID },
         payload: { activity: echoBack }
       });
       
     } catch (error) {
       // Handle send failure
       yield put({
         type: 'DIRECT_LINE/POST_ACTIVITY_REJECTED',
         meta: { clientActivityID },
         payload: error
       });
     }
   }
   ```

4. **State Update**
   ```typescript
   // Activities reducer handles state updates
   function activitiesReducer(state, action) {
     switch (action.type) {
       case 'DIRECT_LINE/POST_ACTIVITY_PENDING':
         return [
           ...state,
           {
             ...action.payload.activity,
             channelData: {
               ...action.payload.activity.channelData,
               'webchat:send-status': 'sending'
             }
           }
         ];
       
       case 'DIRECT_LINE/POST_ACTIVITY_FULFILLED':
         return state.map(activity =>
           activity.channelData?.clientActivityID === action.meta.clientActivityID
             ? {
                 ...action.payload.activity,
                 channelData: {
                   ...action.payload.activity.channelData,
                   'webchat:send-status': 'sent'
                 }
               }
             : activity
         );
     }
   }
   ```

5. **UI Update**
   ```typescript
   // Transcript component automatically re-renders
   const BasicTranscript = () => {
     const activities = useActivities(); // Hook reads from Redux store
     
     return (
       <div>
         {activities.map(activity => (
           <ActivityRenderer 
             key={activity.id || activity.channelData?.clientActivityID}
             activity={activity}
           />
         ))}
       </div>
     );
   };
   ```

## WebSocket Implementation Deep Dive

### Connection Establishment

The WebSocket connection in BotFramework-WebChat is managed through the `botframework-directlinejs` library, which abstracts the low-level WebSocket operations and provides a reactive Observable interface.

**Connection Process:**

1. **Lazy Connection**: WebSocket connection is not established until the first subscriber attaches to `directLine.activity$`
2. **Authentication**: Uses Bearer token passed during DirectLine initialization
3. **Handshake**: Standard WebSocket handshake with additional Bot Framework headers
4. **Stream URL**: `wss://directline.botframework.com/v3/directline/conversations/{conversationId}/stream`

```typescript
// Simplified connection establishment flow
const directLine = new DirectLine({
  token: 'your-directline-token',
  webSocket: window.WebSocket // Can be polyfilled for Node.js environments
});

// This triggers WebSocket connection establishment
const subscription = directLine.activity$.subscribe({
  next: activity => console.log('Received:', activity),
  error: error => console.error('WebSocket error:', error),
  complete: () => console.log('WebSocket connection closed')
});
```

### Observable Stream Architecture

DirectLineJS exposes two primary Observable streams:

**1. Activity Stream (`activity$`)**
```typescript
// Type: Observable<DirectLineActivity>
directLine.activity$.subscribe({
  next: (activity) => {
    // Handles incoming messages, typing indicators, conversation updates
    // Each WebSocket frame containing an activity triggers this callback
    console.log('Activity received:', {
      type: activity.type,           // 'message', 'typing', 'conversationUpdate'
      from: activity.from,           // { id, name, role }
      text: activity.text,           // Message content
      timestamp: activity.timestamp, // ISO 8601 timestamp
      channelData: activity.channelData // Bot-specific data
    });
  }
});
```

**2. Connection Status Stream (`connectionStatus$`)**
```typescript
// Type: Observable<ConnectionStatus>
// ConnectionStatus: 0=Uninitialized, 1=Connecting, 2=Online, 3=Disconnected
directLine.connectionStatus$.subscribe({
  next: (status) => {
    switch(status) {
      case 0: console.log('Uninitialized'); break;
      case 1: console.log('Connecting...'); break;
      case 2: console.log('Connected and online'); break;
      case 3: console.log('Disconnected'); break;
    }
  }
});
```

### Saga Integration with Observables

Web Chat uses Redux-Saga to convert Observable streams into Redux actions:

```typescript
// observeEach.js - Observable to Saga bridge
function observeEachEffect(observable, saga) {
  return call(function* observeEach() {
    const queue = createPromiseQueue();
    const subscription = observable.subscribe({ 
      next: queue.push  // Queue each Observable emission
    });

    try {
      for (;;) {
        const result = yield call(queue.shift); // Wait for next emission
        yield call(saga, result);               // Process with saga
      }
    } finally {
      subscription.unsubscribe(); // Cleanup on cancellation
    }
  });
}

// Usage in observeActivitySaga.ts
function* observeActivity({ directLine, userID }) {
  yield observeEach(directLine.activity$, function* (activity) {
    // Process each WebSocket message through saga
    activity = patchActivityData(activity, userID);
    yield put(queueIncomingActivity(activity));
  });
}
```

### Connection Lifecycle Management

**whileConnected Pattern:**
```typescript
// whileConnected.ts - Lifecycle management
function whileConnectedEffect(fn, ...args) {
  return call(function* whileConnected() {
    for (;;) {
      // Wait for connection establishment
      const { payload: { directLine }, meta: { userID, username } } = 
        yield take([CONNECT_FULFILLING, RECONNECT_FULFILLING]);

      // Start the provided saga with connection
      const task = yield fork(fn, { directLine, userID, username }, ...args);

      // Wait for disconnection or reconnection request
      yield take([DISCONNECT_PENDING, RECONNECT_PENDING]);
      
      // Cancel active tasks when connection changes
      yield cancel(task);
    }
  });
}
```

### Error Handling & Reconnection

**Automatic Reconnection:**
- DirectLineJS handles connection failures with exponential backoff
- Connection status changes trigger Redux actions for UI updates
- Failed WebSocket connections automatically retry with increasing delays

**Error Recovery:**
```typescript
// connectionStatusUpdateSaga.js
function* observeConnectionStatus({ directLine }) {
  yield observeEach(directLine.connectionStatus$, function* (connectionStatus) {
    yield put(connectionStatusUpdate(connectionStatus));
    
    if (connectionStatus === ONLINE) {
      // Connection restored - resume normal operations
      yield put(connectionRestored());
    } else if (connectionStatus === CONNECTING) {
      // Reconnection in progress - show connecting indicator
      yield put(reconnectionStarted());
    }
  });
}
```

### WebSocket Message Types

**Incoming Activity Types:**
- **`message`**: Text/rich content from bot
- **`typing`**: Typing indicators
- **`conversationUpdate`**: Members added/removed
- **`endOfConversation`**: Conversation termination
- **`event`**: Custom bot events
- **`invoke`**: Action requests from bot

**Message Frame Structure:**
```json
{
  "activities": [
    {
      "type": "message",
      "id": "activity-id",
      "timestamp": "2023-12-07T10:30:00.000Z",
      "from": {
        "id": "bot-id",
        "name": "Bot Name",
        "role": "bot"
      },
      "conversation": {
        "id": "conversation-id"
      },
      "text": "Hello! How can I help you?",
      "inputHint": "expectingInput",
      "channelData": {
        "postback": false
      }
    }
  ],
  "watermark": "12345"
}
```

### Performance Optimizations

**Connection Pooling:**
- Single WebSocket connection handles all activity types
- No separate connections for different message types
- Reduces server load and improves reliability

**Efficient Observable Processing:**
```typescript
// createPromiseQueue.js - Efficient async iteration
function createPromiseQueue() {
  const queue = [];
  const resolvers = [];

  return {
    push: (value) => {
      const resolver = resolvers.shift();
      if (resolver) {
        resolver(value); // Immediate resolution if saga is waiting
      } else {
        queue.push(value); // Queue for later if no waiting saga
      }
    },
    shift: () => new Promise(resolve => {
      const value = queue.shift();
      if (value !== undefined) {
        resolve(value); // Immediate value if available
      } else {
        resolvers.push(resolve); // Wait for next push
      }
    })
  };
}
```

### Debugging WebSocket Connections

**Connection Monitoring:**
```typescript
// Debug WebSocket activity
directLine.connectionStatus$.subscribe(status => 
  console.log(`[WebChat] Connection status: ${status}`)
);

directLine.activity$.subscribe(activity => 
  console.log(`[WebChat] Received activity:`, activity)
);

// Monitor WebSocket events in browser DevTools
// Network tab → WS filter → Select WebSocket connection
// Shows individual WebSocket frames and message content
```

**Common Issues:**
- **Connection Drops**: Usually due to network changes or server restarts
- **Token Expiration**: Causes authentication failures requiring new token
- **Firewall/Proxy**: Corporate networks may block WebSocket connections
- **Rate Limiting**: Too many rapid connections may be throttled

## Incoming Message Flow (Bot → User)

### Step-by-Step Process

1. **WebSocket Connection & Event Reception**

   The WebSocket implementation in Web Chat is handled through the `botframework-directlinejs` library, which provides an Observable-based interface to the Direct Line API. Here's how it works:

   ```typescript
   // connectSaga.js establishes WebSocket connection and subscription
   function* connectSaga(directLine) {
     // DirectLineJS starts WebSocket connection only after first activity$ subscriber
     const activitySubscription = directLine.activity$.subscribe({
       next: () => 0  // This triggers the WebSocket connection establishment
     });
     
     // Wait for connection to be established
     for (;;) {
       const { payload: { connectionStatus } } = yield take(UPDATE_CONNECTION_STATUS);
       
       if (connectionStatus === ONLINE) {
         // WebSocket is now connected and ready
         return () => {
           activitySubscription.unsubscribe();
           directLine.end(); // Cleanup WebSocket connection
         };
       } else if (connectionStatus !== UNINITIALIZED && connectionStatus !== CONNECTING) {
         throw new Error(`Failed to connect, DirectLineJS returned ${connectionStatus}.`);
       }
     }
   }
   ```

   **WebSocket Message Processing:**
   ```typescript
   // observeActivitySaga.ts - Processes each WebSocket message
   function* observeActivity({ directLine, userID }) {
     yield observeEach(directLine.activity$, function* (activity) {
       // Each WebSocket frame triggers this function
       console.log('WebSocket message received:', {
         type: activity.type,
         from: activity.from,
         timestamp: activity.timestamp
       });
       
       // Data normalization and validation
       activity = patchNullAsUndefined(activity);
       activity = patchActivityWithFromRole(activity, userID);
       activity = patchFromName(activity);
       
       // Queue for Redux processing
       yield put(queueIncomingActivity(activity));
     });
   }
   ```

2. **Activity Queuing**
   ```typescript
   // queueIncomingActivity action
   function queueIncomingActivity(activity: WebChatActivity) {
     return {
       type: 'DIRECT_LINE/QUEUE_INCOMING_ACTIVITY',
       payload: { activity }
     };
   }
   ```

3. **Saga Processing with Ordering** (`queueIncomingActivitySaga.ts`)
   ```typescript
   function* queueIncomingActivity({ payload: { activity } }) {
     // Handle message ordering for replies
     const { replyToId } = activity;
     
     if (replyToId) {
       // Wait for the original message to appear first
       // This ensures proper conversation threading
       const result = yield race({
         found: waitForActivityId(replyToId),
         timeout: call(sleep, 5000) // 5-second timeout
       });
       
       if ('timeout' in result) {
         console.warn(
           `Timed out waiting for activity "${replyToId}"`,
           { activity, replyToId }
         );
       }
     }
     
     // Add activity to transcript
     yield put(incomingActivity(activity));
     
     // Update suggested actions if this is the latest bot message
     yield updateSuggestedActionsIfNeeded(activity);
   }
   ```

4. **State Integration**
   ```typescript
   // incomingActivity reducer
   function activitiesReducer(state, action) {
     switch (action.type) {
       case 'DIRECT_LINE/INCOMING_ACTIVITY':
         return [
           ...state,
           {
             ...action.payload.activity,
             // Ensure activity has proper metadata
             timestamp: action.payload.activity.timestamp || new Date().toISOString()
           }
         ];
     }
   }
   ```

5. **UI Rendering and Updates**
   ```typescript
   // ActivityRenderer handles different activity types
   const ActivityRenderer = ({ activity }) => {
     const activityMiddleware = useActivityMiddleware();
     
     // Apply middleware for customization
     const processedActivity = activityMiddleware(activity);
     
     // Render based on activity type
     switch (activity.type) {
       case 'message':
         return <MessageActivity activity={processedActivity} />;
       case 'typing':
         return <TypingIndicator activity={processedActivity} />;
       case 'event':
         return <EventActivity activity={processedActivity} />;
       default:
         return <UnknownActivity activity={processedActivity} />;
     }
   };
   ```

## Message Delivery Guarantees

### Reliability Features

1. **Echo Back Confirmation**
   - Every outgoing message receives an echo back from the service
   - Client matches echo back using `clientActivityID`
   - Timeout handling for failed sends

2. **Message Ordering**
   - Incoming messages with `replyToId` wait for parent message
   - Prevents out-of-order display in threaded conversations
   - 5-second timeout prevents indefinite blocking

3. **Connection Recovery**
   ```typescript
   function* reconnectSaga() {
     while (connectionStatus !== ONLINE) {
       try {
         yield call(establishConnection);
         yield put(updateConnectionStatus(ONLINE));
         break;
       } catch (error) {
         yield delay(RECONNECT_INTERVAL);
       }
     }
   }
   ```

4. **Send Status Tracking**
   - Messages show visual status: sending → sent → delivered
   - Error states for failed sends
   - Retry mechanisms for transient failures

### Performance Optimizations

1. **Virtual Scrolling**
   - Large conversation histories don't impact performance
   - Only visible messages are rendered in DOM

2. **Memoization**
   - Activity components use React.memo for re-render prevention
   - Selectors are memoized to prevent unnecessary recalculations

3. **Batching**
   - Multiple rapid incoming messages are batched for efficient updates
   - Redux actions are batched to minimize re-renders

## Error Handling and Edge Cases

### Network Failures
```typescript
function* postActivityWithRetry(activity, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      yield call(postActivity, activity);
      return; // Success
    } catch (error) {
      if (attempt === maxRetries) {
        // Final failure - show error to user
        yield put(showNotification({
          type: 'error',
          message: 'Failed to send message'
        }));
        throw error;
      }
      
      // Wait before retry
      yield delay(1000 * attempt);
    }
  }
}
```

### Duplicate Message Prevention
```typescript
function activitiesReducer(state, action) {
  if (action.type === 'DIRECT_LINE/INCOMING_ACTIVITY') {
    const { activity } = action.payload;
    
    // Check for duplicate based on ID
    if (state.some(existing => existing.id === activity.id)) {
      return state; // Skip duplicate
    }
    
    return [...state, activity];
  }
}
```

### Connection State Management
```typescript
const ConnectionStatus = {
  UNINITIALIZED: 0,  // No connection attempted
  CONNECTING: 1,     // Connection in progress
  ONLINE: 2,         // Connected and ready
  RECONNECTING: 3,   // Attempting to reconnect
  FAILED: 4          // Connection failed
};
```

## Integration Points

### Custom Middleware
```typescript
// Custom activity middleware for message processing
const customActivityMiddleware = (activity) => {
  // Add custom processing
  if (activity.type === 'message') {
    return {
      ...activity,
      text: processCustomMarkdown(activity.text)
    };
  }
  return activity;
};

// Register middleware
<Composer activityMiddleware={customActivityMiddleware}>
  <WebChat />
</Composer>
```

### Event Hooks
```typescript
// Listen for message delivery events
const MyComponent = () => {
  const activities = useActivities();
  
  useEffect(() => {
    const lastActivity = activities[activities.length - 1];
    if (lastActivity?.from?.role === 'bot') {
      // React to new bot message
      onNewBotMessage(lastActivity);
    }
  }, [activities]);
};
```

This comprehensive message delivery system ensures reliable, ordered, and efficient communication between users and bots while providing extensive customization capabilities.

## WebSocket Summary

The WebSocket implementation in BotFramework-WebChat provides the real-time foundation for bot communication:

### Key WebSocket Characteristics

- **Lazy Connection**: WebSocket connects only when `directLine.activity$` gets its first subscriber
- **Single Connection**: One WebSocket handles all activity types (messages, typing, events)
- **Observable Streams**: ReactiveX pattern with `activity$` and `connectionStatus$` observables
- **Automatic Management**: DirectLineJS handles connection lifecycle, reconnection, and error recovery
- **Saga Integration**: Redux-Saga converts Observable events into Redux actions for state management

### Connection Flow Summary
```
User Opens Chat → Subscribe to activity$ → WebSocket Connects → Receive Messages
     ↓                     ↓                    ↓                  ↓
DirectLine.activity$  → Observable Stream → Saga Processing → Redux Store → UI Updates
```

### WebSocket URL Pattern
```
wss://directline.botframework.com/v3/directline/conversations/{conversationId}/stream
```

This architecture ensures real-time message delivery while maintaining clean separation between the transport layer (WebSocket), business logic (Sagas), and presentation layer (React components).