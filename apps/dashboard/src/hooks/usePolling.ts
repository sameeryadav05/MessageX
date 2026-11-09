import {useCallback,useEffect,useState} from "react";
export function usePolling<T>(loader:()=>Promise<T>,interval=5000){const[data,setData]=useState<T|null>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState<string|null>(null);const[updatedAt,setUpdatedAt]=useState<Date|null>(null);
const refresh=useCallback(async()=>{try{setData(await loader());setError(null);setUpdatedAt(new Date())}catch(e){setError(e instanceof Error?e.message:"Unable to load data")}finally{setLoading(false)}},[loader]);
useEffect(()=>{void refresh();const id=window.setInterval(()=>void refresh(),interval);return()=>window.clearInterval(id)},[refresh,interval]);return{data,loading,error,updatedAt,refresh}}
