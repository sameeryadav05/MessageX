        Different components of MessageX      

                         MESSAGE X
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
       Management Side                Message Side
              │                             │
        React Dashboard                SDKs
              │                       JS / Python / Java
              │                             │
        Express API                       TCP
              │                             │
              ▼                             ▼
         PostgreSQL                  MessageX Broker
                                            │
                              ┌─────────────┼─────────────┐
                              ▼             ▼             ▼
                           Exchange      Exchange      Exchange
                              │             │             │
                              ▼             ▼             ▼
                           Queue         Queue         Queue
                              │             │             │
                              ▼             ▼             ▼
                          Consumer      Consumer      Consumer

Database Postgresql Role : 

                     MessageX Broker
                       │
          ┌────────────┴────────────┐
          │                         │
     Runtime State             PostgreSQL
       (memory)                 (metadata)
          │                         │
          │                    users
          │                    queues
          │                    exchanges
          │                    bindings
          │                    permissions
          │                    configuration
          │
     messages / consumers /
     connections / delivery

project folder structure : 
    messagex/
│
├── apps/
│   │
│   ├── broker/
│   │   ├── src/
│   │   │   ├── server/
│   │   │   ├── protocol/
│   │   │   ├── connection/
│   │   │   ├── auth/
│   │   │   ├── queues/
│   │   │   ├── exchanges/
│   │   │   ├── routing/
│   │   │   ├── consumers/
│   │   │   ├── delivery/
│   │   │   ├── persistence/
│   │   │   └── metrics/
│   │   │
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── dashboard/
│   │   ├── src/
│   │   ├── public/
│   │   └── package.json
│   │
│   └── docs/
│
├── packages/
│   │
│   ├── protocol/
│   │
│   ├── client-js/
│   │
│   └── shared/
│
├── clients/
│   │
│   ├── python/
│   │
│   └── java/
│
├── database/
│   │
│   ├── migrations/
│   └── seeds/
│
├── docker/
│
├── examples/
│   ├── node-producer/
│   ├── node-consumer/
│   ├── python-worker/
│   ├── java-worker/
│   ├── order-processing/
│   └── microservices-demo/
│
├── docker-compose.yml
├── package.json
├── README.md
└── .gitignore

Role of apps/broker/src

Directory	Responsibility
server	        Start and stop TCP and HTTP servers
protocol	    Parse and validate MessageX frames
connection	    Manage TCP connections
auth	        Authenticate broker clients
queues	        Queue creation and message storage
exchanges	    Exchange management
routing	        Route messages to queues
consumer	    Manage registered consumers
delivery	    Deliver messages and handle acknowledgements
persistence	    PostgreSQL integration
metrics	        Broker monitoring
management	    Express routes, controllers and middleware