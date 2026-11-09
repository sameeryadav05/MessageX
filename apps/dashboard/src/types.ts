export interface Queue{id:string;name:string;durable?:boolean;exclusive?:boolean;autoDelete?:boolean;createdAt?:string}
export interface Exchange{id:string;name:string;type:string;durable?:boolean;createdAt?:string}
export interface Binding{id:string;exchangeName:string;queueName:string;routingKey:string}
export interface BrokerConnection{id:string;clientName?:string|null;username?:string|null;remoteAddress?:string;remotePort?:number;connected?:boolean;authenticated?:boolean}
export interface Overview{queues:number;exchanges:number;activeConnections:number;bindings:number;messages:number;readyMessages:number;inFlightMessages:number;deadMessages:number}
export interface DetailedHealth{health?:{status?:string;timestamp?:string;uptimeSeconds?:number;database?:{status?:string};connections?:{active?:number}};resources?:{process?:{cpuUsagePercent?:number;memory?:{rssMB?:number;heapUsedMB?:number;heapTotalMB?:number;externalMB?:number;arrayBuffersMB?:number}};system?:{cpuCores?:number;totalMemoryMB?:number;freeMemoryMB?:number;usedMemoryMB?:number;memoryUsagePercent?:number};eventLoop?:{meanDelayMs?:number;p95DelayMs?:number}}}
export interface Metrics{totals?:Record<string,number>;ratesPerSecond?:{published?:number;delivered?:number;acknowledged?:number}}
