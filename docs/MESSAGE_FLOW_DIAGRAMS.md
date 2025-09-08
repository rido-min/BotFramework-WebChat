# BotFramework-WebChat Message Flow Diagrams

This document contains visual representations of the message delivery architecture in BotFramework-WebChat.

## Outgoing Message Flow (User → Bot)

```mermaid
sequenceDiagram
    participant User
    participant SendBox as SendBox Component
    participant Redux as Redux Store
    participant Saga as Post Activity Saga
    participant DirectLine as Direct Line Service
    participant Bot as Bot Service
    participant UI as Transcript UI

    User->>SendBox: Types message & clicks Send
    SendBox->>Redux: dispatch(postActivity(activity))
    Redux->>Saga: POST_ACTIVITY action
    
    Saga->>Redux: POST_ACTIVITY_PENDING
    Redux->>UI: Update with "sending" status
    UI-->>User: Show message with ⏳ icon
    
    Saga->>DirectLine: HTTP POST /conversations/{id}/activities
    DirectLine->>Bot: Forward activity
    Bot-->>DirectLine: Process and acknowledge
    DirectLine-->>Saga: Return activity with ID (echo-back)
    
    Saga->>Redux: POST_ACTIVITY_FULFILLED
    Redux->>UI: Update with "sent" status
    UI-->>User: Show message with ✅ icon
    
    Note over Bot: Bot processes message and prepares response
    Bot->>DirectLine: Send response activity
    DirectLine->>Saga: WebSocket message
    Saga->>Redux: QUEUE_INCOMING_ACTIVITY
    Redux->>UI: Add bot response
    UI-->>User: Display bot message
```

## Incoming Message Flow (Bot → User)

```mermaid
sequenceDiagram
    participant Bot as Bot Service
    participant DirectLine as Direct Line Service
    participant WebSocket as WebSocket Connection
    participant Saga as Queue Incoming Saga
    participant Redux as Redux Store
    participant UI as Transcript UI
    participant User

    Bot->>DirectLine: Send activity to conversation
    DirectLine->>WebSocket: Push activity via WebSocket
    WebSocket->>Saga: activity$ stream event
    
    Saga->>Saga: Check for replyToId (threading)
    
    alt Has replyToId (threaded message)
        Saga->>Redux: Wait for parent message
        Redux-->>Saga: Parent message found or timeout
    end
    
    Saga->>Redux: dispatch(incomingActivity(activity))
    Redux->>UI: Add activity to transcript
    UI->>User: Render new message
    
    alt Last message is from bot
        Saga->>Redux: Update suggested actions
        Redux->>UI: Show quick reply buttons
        UI-->>User: Display action buttons
    end
```

## System Architecture Overview

```mermaid
graph TB
    subgraph "User Interface Layer"
        SendBox[Send Box Component]
        Transcript[Transcript Component]
        Activities[Activity Components]
    end
    
    subgraph "Application Layer"
        Hooks[React Hooks API]
        Middleware[Activity Middleware]
    end
    
    subgraph "State Management Layer"
        Store[Redux Store]
        Sagas[Redux Sagas]
        Actions[Action Creators]
        Reducers[Reducers]
    end
    
    subgraph "Communication Layer"
        DirectLine[Direct Line Client]
        WebSocket[WebSocket Connection]
        HTTP[HTTP Client]
    end
    
    subgraph "External Services"
        BotService[Bot Framework Service]
        Speech[Speech Services]
    end
    
    SendBox --> Actions
    Actions --> Store
    Store --> Sagas
    Sagas --> DirectLine
    DirectLine --> HTTP
    DirectLine --> WebSocket
    HTTP --> BotService
    WebSocket --> BotService
    
    BotService --> WebSocket
    WebSocket --> Sagas
    Sagas --> Store
    Store --> Hooks
    Hooks --> Transcript
    Transcript --> Activities
    
    Store --> Reducers
    Middleware --> Activities
    Speech --> DirectLine
```

## Package Dependencies

```mermaid
graph LR
    Bundle[bundle] --> Component[component]
    Component --> API[api]
    Component --> Core[core]
    API --> Hooks[react-hooks]
    API --> Store[redux-store]
    Core --> Store
    Hooks --> Store
    
    DirectLineSpeech[directlinespeech] --> Core
    FluentTheme[fluent-theme] --> Component
    Styles[styles] --> Component
    
    Bundle --> |distributes| CDN[CDN Bundle]
    Component --> |renders| UI[Web UI]
    Core --> |communicates| DirectLineService[Direct Line Service]
```

## Message State Transitions

```mermaid
stateDiagram-v2
    [*] --> Draft: User types message
    Draft --> Pending: User submits
    Pending --> Sending: Saga processes
    Sending --> Sent: Echo-back received
    Sending --> Failed: Network error
    Failed --> Pending: User retries
    Sent --> [*]: Message delivered
    
    note right of Sending
        Direct Line API call
        Wait for confirmation
    end note
    
    note right of Failed
        Show error indicator
        Allow retry action
    end note
```

## Connection State Management

```mermaid
stateDiagram-v2
    [*] --> Uninitialized
    Uninitialized --> Connecting: connect()
    Connecting --> Online: WebSocket ready
    Connecting --> Failed: Connection error
    Online --> Reconnecting: Connection lost
    Reconnecting --> Online: Reconnect success
    Reconnecting --> Failed: Max retries exceeded
    Failed --> Connecting: Manual retry
    Online --> Disconnected: disconnect()
    Disconnected --> [*]
    
    note right of Online
        Ready to send/receive
        Active WebSocket
    end note
    
    note right of Reconnecting
        Exponential backoff
        Automatic retry
    end note
```

## Activity Processing Pipeline

```mermaid
flowchart TD
    Start([Activity Received]) --> Type{Activity Type?}
    
    Type -->|message| ValidateMessage[Validate Message]
    Type -->|typing| ProcessTyping[Process Typing Indicator]
    Type -->|event| ProcessEvent[Process Event]
    
    ValidateMessage --> Sanitize[Sanitize Content]
    Sanitize --> CheckOrder{Has replyToId?}
    
    CheckOrder -->|Yes| WaitForParent[Wait for Parent Message]
    CheckOrder -->|No| AddToTranscript[Add to Transcript]
    WaitForParent --> AddToTranscript
    
    ProcessTyping --> UpdateIndicator[Update Typing Indicator]
    ProcessEvent --> TriggerEvent[Trigger Event Handler]
    
    AddToTranscript --> UpdateSuggestions{Last bot message?}
    UpdateSuggestions -->|Yes| SetSuggestions[Set Suggested Actions]
    UpdateSuggestions -->|No| Complete
    SetSuggestions --> Complete([Complete])
    
    UpdateIndicator --> Complete
    TriggerEvent --> Complete
```

## Error Handling Flow

```mermaid
flowchart TD
    SendMessage[Send Message] --> NetworkCall{Network Call}
    NetworkCall -->|Success| EchoBack[Wait for Echo-back]
    NetworkCall -->|Failure| RetryLogic{Retry Count < Max?}
    
    RetryLogic -->|Yes| Delay[Exponential Backoff]
    Delay --> NetworkCall
    RetryLogic -->|No| ShowError[Show Error Message]
    
    EchoBack -->|Received| Success[Mark as Sent]
    EchoBack -->|Timeout| ShowWarning[Show Warning]
    
    ShowError --> AllowRetry[Allow Manual Retry]
    ShowWarning --> AllowRetry
    AllowRetry --> NetworkCall
    
    Success --> Complete([Message Delivered])
```

These diagrams illustrate the comprehensive message delivery system in BotFramework-WebChat, showing how user interactions flow through the various architectural layers to provide a reliable, real-time messaging experience.