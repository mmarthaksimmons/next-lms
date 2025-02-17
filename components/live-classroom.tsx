'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import AgoraRTC, { IAgoraRTCClient, ICameraVideoTrack, IMicrophoneAudioTrack, IRemoteVideoTrack } from 'agora-rtc-sdk-ng'
import { useAuth } from '@clerk/nextjs'
import MuxPlayer from '@mux/mux-player-react'
import toast from 'react-hot-toast'
import { AxiosInstance } from 'axios'
import { Button } from '@/components/ui/button'
import { createAxiosInstance } from '@/lib/axios'

interface LiveClassroomProps {
  courseId: string;
  isTeacher: boolean;
}

interface Recording {
  id: string;
  title: string;
  playbackId: string;
  sessionDate: string;
}

export const LiveClassroom = ({ courseId, isTeacher }: LiveClassroomProps) => {
  const { getToken } = useAuth()
  const isMounted = useRef(true)
  const axiosInstanceRef = useRef<AxiosInstance | null>(null)
  const [client, setClient] = useState<IAgoraRTCClient | null>(null)
  const [localVideoTrack, setLocalVideoTrack] = useState<ICameraVideoTrack | null>(null)
  const [localAudioTrack, setLocalAudioTrack] = useState<IMicrophoneAudioTrack | null>(null)
  const [remoteVideoTrack, setRemoteVideoTrack] = useState<IRemoteVideoTrack | null>(null)
  const [isLive, setIsLive] = useState(false)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const initAxios = async () => {
      try {
        const token = await getToken()
        if (!token) {
          throw new Error('Authentication token not available')
        }
        axiosInstanceRef.current = createAxiosInstance(token)
        setIsReady(true)
      } catch (error) {
        console.error('Failed to initialize authenticated client:', error)
        toast.error('Authentication failed. Please try refreshing the page.')
      }
    }
    initAxios()
  }, [getToken])

  const cleanupTracks = useCallback(async () => {
    try {
      if (!isMounted.current) return
      if (localVideoTrack) {
        try {
          await localVideoTrack.stop()
          await localVideoTrack.close()
        } catch (error) {
          console.error('Error closing local video track:', error)
        }
        setLocalVideoTrack(null)
      }
      if (localAudioTrack) {
        try {
          await localAudioTrack.stop()
          await localAudioTrack.close()
        } catch (error) {
          console.error('Error closing local audio track:', error)
        }
        setLocalAudioTrack(null)
      }
      if (client && isConnected) {
        try {
          await client.leave()
        } catch (error) {
          console.error('Error leaving client:', error)
        }
        setIsConnected(false)
      }
    } catch (error) {
      console.error('Cleanup error:', error)
    }
  }, [client, localVideoTrack, localAudioTrack, isConnected])

  const joinLiveStream = useCallback(async () => {
    if (!isReady || !axiosInstanceRef.current || !isMounted.current) {
      toast.error('Not ready yet. Please try again.')
      return
    }

    try {
      if (isConnected) {
        console.log('Already connected to stream')
        return
      }

      console.log('Student joining live stream...')
      const response = await axiosInstanceRef.current.post(`/api/courses/${courseId}/live`, {})
      if (!isMounted.current) return

      console.log('Agora credentials received:', {
        appId: response.data.appId,
        channelName: response.data.channelName,
        uid: response.data.uid,
        token: '[REDACTED]'
      })
      const { token, channelName, appId } = response.data

      if (!client) {
        throw new Error('Video client not initialized')
      }

      await client.join(appId, channelName, token)
      if (isMounted.current) {
        setIsConnected(true)
        console.log('Joined live stream as viewer')
      }
    } catch (error: any) {
      if (!isMounted.current) return
      console.error('Failed to join stream:', error)
      toast.error('Failed to join live stream')
      await cleanupTracks()
    }
  }, [courseId, client, isConnected, cleanupTracks, isReady])

  useEffect(() => {
    let isMounted = true
    const checkLiveStatus = async () => {
      if (!isReady || !axiosInstanceRef.current || !isMounted) return

      try {
        console.log('Checking live status...')
        const response = await axiosInstanceRef.current.get(`/api/courses/${courseId}`)
        if (!isMounted) return
        console.log('Live status response:', response.data)
        const isLiveNow = response.data.isCourseLive && response.data.isLiveActive
        setIsLive(isLiveNow)

        if (!isTeacher && isLiveNow && client && !isConnected) {
          await joinLiveStream()
        }
        if (!isLiveNow && isConnected) {
          console.log('Stream ended, cleaning up connection')
          await cleanupTracks()
        }
      } catch (error: any) {
        if (!isMounted) return
        console.error('Status check error:', error)
        toast.error(error?.response?.data || error?.message || 'Failed to check live status')
      } finally {
        if (isMounted) {
          setIsInitialLoading(false)
        }
      }
    }

    let interval: NodeJS.Timeout | null = null
    if (isReady && axiosInstanceRef.current) {
      checkLiveStatus()
      interval = setInterval(checkLiveStatus, 5000)
    }
    return () => {
      isMounted = false
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [courseId, client, isTeacher, joinLiveStream, isConnected, cleanupTracks, isReady])

  const fetchRecordings = useCallback(async () => {
    if (!isReady || !axiosInstanceRef.current || !isMounted.current) return

    try {
      const response = await axiosInstanceRef.current.get(`/api/courses/${courseId}/live/recording`)
      if (isMounted.current) {
        setRecordings(response.data)
      }
    } catch (error: any) {
      if (isMounted.current) {
        console.error('Fetch recordings error:', error)
        toast.error(error?.response?.data || error?.message || 'Failed to fetch recordings')
      }
    }
  }, [courseId, isReady])

  useEffect(() => {
    if (isReady && axiosInstanceRef.current) {
      fetchRecordings()
    }
  }, [fetchRecordings, isReady])

  useEffect(() => {
    let isMounted = true
    const initAgora = async () => {
      if (!isMounted) return
      try {
        console.log('Initializing Agora client...')
        const agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })

        if (!isTeacher && isMounted) {
          agoraClient.on('user-published', async (user, mediaType) => {
            if (!isMounted) return
            try {
              await agoraClient.subscribe(user, mediaType)
              console.log('Subscribed to teacher stream:', mediaType)

              if (mediaType === 'video') {
                const videoTrack = user.videoTrack
                if (videoTrack && isMounted) {
                  setRemoteVideoTrack(videoTrack)
                }
              }
              if (mediaType === 'audio') {
                const audioTrack = user.audioTrack
                if (audioTrack && isMounted) {
                  audioTrack.play()
                }
              }
            } catch (error) {
              if (!isMounted) return
              console.error('Subscribe error:', error)
            }
          })

          agoraClient.on('user-unpublished', (user, mediaType) => {
            if (!isMounted) return
            console.log('Teacher stopped streaming:', mediaType)
            if (mediaType === 'video') {
              setRemoteVideoTrack(null)
            }
          })
        }

        if (isMounted) {
          setClient(agoraClient)
          console.log('Agora client initialized')
        }
      } catch (error: any) {
        if (!isMounted) return
        console.error('Agora init error:', error)
        toast.error('Failed to initialize video client')
      }
    }

    initAgora()
    return () => {
      isMounted = false
      cleanupTracks()
    }
  }, [isTeacher, cleanupTracks])

  useEffect(() => {
    return () => {
      isMounted.current = false
      cleanupTracks()
    }
  }, [cleanupTracks])

  const startLiveStream = async () => {
    if (!isReady || !axiosInstanceRef.current || !isMounted.current) {
      toast.error('Not ready yet. Please try again.')
      return
    }

    try {
      if (isMounted.current) setIsLoading(true)
      console.log('Starting live stream...')
      const response = await axiosInstanceRef.current.post(`/api/courses/${courseId}/live`, {})
      if (!isMounted.current) return
      console.log('Agora credentials received:', {
        appId: response.data.appId,
        channelName: response.data.channelName,
        uid: response.data.uid,
        token: '[REDACTED]'
      })
      const { token, channelName, appId } = response.data

      if (!client) {
        throw new Error('Video client not initialized')
      }

      if (!isConnected) {
        await client.join(appId, channelName, token)
        if (isMounted.current) setIsConnected(true)
        console.log('Joined Agora channel')
      }

      console.log('Creating video and audio tracks...')
      const videoTrack = await AgoraRTC.createCameraVideoTrack()
      const audioTrack = await AgoraRTC.createMicrophoneAudioTrack()

      if (!isMounted.current) {
        await videoTrack.close()
        await audioTrack.close()
        return
      }

      console.log('Publishing tracks...')
      await client.publish([videoTrack, audioTrack])
      console.log('Tracks published')

      if (isMounted.current) {
        setLocalVideoTrack(videoTrack)
        setLocalAudioTrack(audioTrack)
      } else {
        await videoTrack.close()
        await audioTrack.close()
        return
      }

      try {
        console.log('Updating course status...')
        await axiosInstanceRef.current.patch(`/api/courses/${courseId}`, {
          isCourseLive: true,
          isLiveActive: true
        })
        if (isMounted.current) {
          setIsLive(true)
          toast.success('Live stream started!')
          console.log('Live stream started successfully')
        }
      } catch (error: any) {
        console.error('Status update error:', error)
        await cleanupTracks()
        throw new Error(error?.response?.data || error?.message || 'Failed to update course status')
      }
    } catch (error: any) {
      if (!isMounted.current) return
      console.error('Live stream error:', error)
      toast.error(error?.response?.data || error?.message || 'Failed to start live stream')
      await cleanupTracks()
    } finally {
      if (isMounted.current) setIsLoading(false)
    }
  }

  const stopLiveStream = async () => {
    if (!isReady || !axiosInstanceRef.current || !isMounted.current) {
      toast.error('Not ready yet. Please try again.')
      return
    }

    try {
      if (isMounted.current) setIsLoading(true)
      console.log('Stopping live stream...')
      if (!client) {
        throw new Error('Video client not initialized')
      }

      const recordingUrl = 'https://example.com/recording.mp4'

      await cleanupTracks()
      if (!isMounted.current) return

      console.log('Updating live session status...')
      await axiosInstanceRef.current.delete(`/api/courses/${courseId}/live`)
      if (!isMounted.current) return

      console.log('Storing recording...')
      await axiosInstanceRef.current.post(`/api/courses/${courseId}/live/recording`, {
        recordingUrl,
        title: `Live Session - ${new Date().toLocaleDateString()}`,
      })
      if (!isMounted.current) return

      try {
        console.log('Updating course status...')
        await axiosInstanceRef.current.patch(`/api/courses/${courseId}`, {
          isCourseLive: false,
          isLiveActive: false
        })
        if (isMounted.current) {
          setIsLive(false)
          toast.success('Live stream ended and recording saved')
          console.log('Live stream ended successfully')
        }
      } catch (error: any) {
        if (!isMounted.current) return
        console.error('Status update error:', error)
        toast.error(error?.response?.data || error?.message || 'Failed to update course status')
        throw error
      }
      if (isMounted.current) fetchRecordings()
    } catch (error: any) {
      if (!isMounted.current) return
      console.error('Stop stream error:', error)
      toast.error(error?.response?.data || error?.message || 'Failed to stop live stream')
    } finally {
      if (isMounted.current) setIsLoading(false)
    }
  }

  return (
    <div className='flex flex-col space-y-8'>
      {/* Live Stream Section */}
      {isInitialLoading ? (
        <div className="flex items-center justify-center h-[300px]">
          <p className="text-slate-500">Loading...</p>
        </div>
      ) : (
        <div className='space-y-4'>
          {isTeacher && (
          <div className='flex items-center gap-x-2 mb-4'>
            {!isLive && (
              <Button
                onClick={startLiveStream}
                variant='default'
                size='lg'
                className='w-full md:w-auto'
                disabled={isLoading}
              >
                Start Live Session
              </Button>
            )}
            {isLive && (
              <Button
                onClick={stopLiveStream}
                variant='destructive'
                size='lg'
                className='w-full md:w-auto'
                disabled={isLoading}
              >
                End Live Session
              </Button>
            )}
          </div>
        )}
        <div className='relative w-full aspect-video bg-slate-800 rounded-lg overflow-hidden'>
          {/* Teacher's local video */}
          {isTeacher && localVideoTrack && (
            <div className='absolute inset-0'>
              <div
                id='local-video'
                className='w-full h-full'
                ref={(element) => {
                  if (element && localVideoTrack && isMounted.current) {
                    try {
                      if (!element.hasChildNodes()) {
                        localVideoTrack.play(element)
                      }
                    } catch (error) {
                      console.error('Failed to play local video:', error)
                    }
                  }
                }}
              />
            </div>
          )}
          {/* Student's remote video */}
          {!isTeacher && remoteVideoTrack && (
            <div className='absolute inset-0'>
              <div
                id='remote-video'
                className='w-full h-full'
                ref={(element) => {
                  if (element && remoteVideoTrack && isMounted.current) {
                    try {
                      if (!element.hasChildNodes()) {
                        remoteVideoTrack.play(element)
                      }
                    } catch (error) {
                      console.error('Failed to play remote video:', error)
                    }
                  }
                }}
              />
            </div>
          )}
          {/* Placeholder when no video */}
          {((isTeacher && !localVideoTrack) || (!isTeacher && !remoteVideoTrack)) && (
            <div className='absolute inset-0 flex items-center justify-center'>
              <p className='text-slate-400'>
                {isTeacher
                  ? 'Click Start Live to begin streaming'
                  : isLive
                    ? 'Connecting to live stream...'
                    : 'Waiting for teacher to start the live stream'
                }
              </p>
            </div>
          )}
          </div>
        </div>
      )}

      {/* Past Recordings Section */}
      {recordings.length > 0 && (
        <div className='space-y-4'>
          <h3 className='text-lg font-medium'>Past Recordings</h3>
          <div className='grid grid-cols-1 gap-4'>
            {recordings.map((recording) => (
              <div key={recording.id} className='space-y-2'>
                <h4 className='font-medium'>{recording.title}</h4>
                <p className='text-sm text-slate-500'>
                  {new Date(recording.sessionDate).toLocaleDateString()}
                </p>
                <div className='aspect-video'>
                  <MuxPlayer
                    playbackId={recording.playbackId}
                    metadata={{
                      video_title: recording.title,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
