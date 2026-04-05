import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import Cookies from 'js-cookie';
import type { GitHubConnection, GitHubDeviceFlow, GitHubTokenType, GitHubUserResponse } from '~/types/GitHub';
import { useGitHubAPI } from './useGitHubAPI';
import { githubConnection, isConnecting, updateGitHubConnection } from '~/lib/stores/github';

export interface ConnectionState {
  isConnected: boolean;
  isLoading: boolean;
  isConnecting: boolean;
  connection: GitHubConnection | null;
  error: string | null;
  isServerSide: boolean;
  deviceFlow: GitHubDeviceFlow | null;
}

export interface UseGitHubConnectionReturn extends ConnectionState {
  connect: (token: string, tokenType: GitHubTokenType) => Promise<void>;
  startWebOAuth: () => void;
  startDeviceFlow: () => Promise<void>;
  cancelDeviceFlow: () => void;
  disconnect: () => void;
  refreshConnection: () => Promise<void>;
  testConnection: () => Promise<boolean>;
}

const STORAGE_KEY = 'github_connection';
const DEVICE_FLOW_URL = '/api/github-device';
const WEB_OAUTH_LOGIN_URL = '/api/github-login';

function getAuthorizationHeader(token: string, tokenType: GitHubTokenType) {
  return `${tokenType === 'classic' ? 'token' : 'Bearer'} ${token}`;
}

export function useGitHubConnection(): UseGitHubConnectionReturn {
  const connection = useStore(githubConnection);
  const connecting = useStore(isConnecting);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [deviceFlow, setDeviceFlow] = useState<GitHubDeviceFlow | null>(null);

  useGitHubAPI();

  useEffect(() => {
    loadSavedConnection();
  }, []);

  // Detect OAuth callback: pick up temporary token cookie set by /api/github-callback
  useEffect(() => {
    const oauthToken = Cookies.get('github_oauth_token');

    if (oauthToken) {
      // Remove the temporary cookie immediately
      Cookies.remove('github_oauth_token');

      // Auto-connect using the token from the OAuth callback
      void connect(oauthToken, 'oauth');
    }

    // Check for error passed via URL query param
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const githubError = params.get('github_error');

      if (githubError) {
        setError(decodeURIComponent(githubError));
        toast.error(decodeURIComponent(githubError));

        // Clean the URL
        params.delete('github_error');
        const cleanUrl = params.toString()
          ? `${window.location.pathname}?${params.toString()}`
          : window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
      }
    }
  }, []); // Run once on mount

  useEffect(() => {
    if (!deviceFlow || deviceFlow.status !== 'pending') {
      return undefined;
    }

    if (Date.now() >= deviceFlow.expiresAt) {
      const expiredMessage = 'GitHub device code expired. Start again.';
      setError(expiredMessage);
      setDeviceFlow((current) =>
        current
          ? {
              ...current,
              status: 'error',
              error: expiredMessage,
              message: expiredMessage,
            }
          : null,
      );
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      void pollDeviceFlow(deviceFlow.deviceCode);
    }, deviceFlow.interval * 1000);

    return () => window.clearTimeout(timeoutId);
  }, [deviceFlow?.deviceCode, deviceFlow?.expiresAt, deviceFlow?.interval, deviceFlow?.status]);

  const applyConnection = useCallback(
    (connectionData: GitHubConnection, successMessage: string) => {
      Cookies.set('githubToken', connectionData.token);
      Cookies.set('githubUsername', connectionData.user?.login || '');
      Cookies.set(
        'git:github.com',
        JSON.stringify({
          username: connectionData.token,
          password: 'x-oauth-basic',
        }),
      );

      updateGitHubConnection(connectionData);
      toast.success(successMessage);
    },
    [updateGitHubConnection],
  );

  const refreshConnectionData = useCallback(async (currentConnection: GitHubConnection) => {
    if (!currentConnection.token) {
      return;
    }

    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          Authorization: getAuthorizationHeader(currentConnection.token, currentConnection.tokenType),
          'User-Agent': 'Bolt.diy',
        },
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const userData = (await response.json()) as GitHubUserResponse;
      updateGitHubConnection({
        ...currentConnection,
        user: userData,
      });
    } catch (refreshError) {
      console.error('Error refreshing connection data:', refreshError);
    }
  }, []);

  const loadSavedConnection = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (connection?.user) {
        setIsLoading(false);
        return;
      }

      if (connection?.token && (!connection.user || !connection.stats)) {
        await refreshConnectionData(connection);
      }
    } catch (loadError) {
      console.error('Error loading saved connection:', loadError);
      setError('Failed to load saved connection');
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setIsLoading(false);
    }
  }, [connection, refreshConnectionData]);

  const connect = useCallback(
    async (token: string, tokenType: GitHubTokenType) => {
      if (!token.trim()) {
        setError('Token is required');
        return;
      }

      isConnecting.set(true);
      setError(null);
      setDeviceFlow(null);

      try {
        const response = await fetch('https://api.github.com/user', {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            Authorization: getAuthorizationHeader(token, tokenType),
            'User-Agent': 'Bolt.diy',
          },
        });

        if (!response.ok) {
          throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
        }

        const userData = (await response.json()) as GitHubUserResponse;
        applyConnection(
          {
            user: userData,
            token,
            tokenType,
            authMethod: 'token',
          },
          `Connected to GitHub as ${userData.login}`,
        );
      } catch (connectError) {
        console.error('Failed to connect to GitHub:', connectError);

        const errorMessage = connectError instanceof Error ? connectError.message : 'Failed to connect to GitHub';
        setError(errorMessage);
        toast.error(`Failed to connect: ${errorMessage}`);
        throw connectError;
      } finally {
        isConnecting.set(false);
      }
    },
    [applyConnection],
  );

  const pollDeviceFlow = useCallback(
    async (deviceCode: string) => {
      try {
        const response = await fetch(DEVICE_FLOW_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'poll',
            deviceCode,
          }),
        });

        const data = (await response.json().catch(() => ({}))) as {
          status?: 'pending' | 'complete' | 'error';
          message?: string;
          error?: string;
          interval?: number;
          accessToken?: string;
          user?: GitHubUserResponse;
        };

        if (!response.ok || data.status === 'error') {
          throw new Error(data.error || data.message || 'GitHub authorization failed.');
        }

        if (data.status === 'pending') {
          setDeviceFlow((current) =>
            current && current.deviceCode === deviceCode
              ? {
                  ...current,
                  interval: data.interval ?? current.interval,
                  message: data.message || current.message,
                }
              : current,
          );
          return;
        }

        if (data.status === 'complete' && data.accessToken && data.user) {
          setDeviceFlow((current) =>
            current && current.deviceCode === deviceCode
              ? {
                  ...current,
                  status: 'success',
                  message: 'GitHub authorization complete.',
                }
              : current,
          );

          applyConnection(
            {
              user: data.user,
              token: data.accessToken,
              tokenType: 'oauth',
              authMethod: 'device',
            },
            `Connected to GitHub as ${data.user.login}`,
          );
          setDeviceFlow(null);
        }
      } catch (pollError) {
        console.error('Failed to poll GitHub device flow:', pollError);
        const errorMessage = pollError instanceof Error ? pollError.message : 'GitHub authorization failed.';
        setError(errorMessage);
        setDeviceFlow((current) =>
          current && current.deviceCode === deviceCode
            ? {
                ...current,
                status: 'error',
                error: errorMessage,
                message: errorMessage,
              }
            : current,
        );
      }
    },
    [applyConnection],
  );

  const startDeviceFlow = useCallback(async () => {
    isConnecting.set(true);
    setError(null);

    try {
      const response = await fetch(DEVICE_FLOW_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'start',
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        deviceCode?: string;
        userCode?: string;
        verificationUri?: string;
        verificationUriComplete?: string;
        interval?: number;
        expiresIn?: number;
        error?: string;
      };

      if (!response.ok || !data.deviceCode || !data.userCode || !data.verificationUri) {
        throw new Error(data.error || 'Failed to start GitHub device login.');
      }

      setDeviceFlow({
        status: 'pending',
        deviceCode: data.deviceCode,
        userCode: data.userCode,
        verificationUri: data.verificationUri,
        verificationUriComplete: data.verificationUriComplete,
        interval: data.interval ?? 5,
        expiresAt: Date.now() + (data.expiresIn ?? 900) * 1000,
        message: 'Approve this login on GitHub to finish connecting.',
      });
    } catch (startError) {
      console.error('Failed to start GitHub device flow:', startError);
      const errorMessage = startError instanceof Error ? startError.message : 'Failed to start GitHub device login.';
      setError(errorMessage);
      setDeviceFlow(null);
      toast.error(errorMessage);
      throw startError;
    } finally {
      isConnecting.set(false);
    }
  }, []);

  const cancelDeviceFlow = useCallback(() => {
    setDeviceFlow(null);
    setError(null);
  }, []);

  const startWebOAuth = useCallback(() => {
    window.location.href = WEB_OAUTH_LOGIN_URL;
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    Cookies.remove('githubToken');
    Cookies.remove('githubUsername');
    Cookies.remove('git:github.com');

    updateGitHubConnection({
      user: null,
      token: '',
      tokenType: 'classic',
      authMethod: 'token',
    });

    setDeviceFlow(null);
    setError(null);
    toast.success('Disconnected from GitHub');
  }, []);

  const refreshConnection = useCallback(async () => {
    if (!connection?.token) {
      throw new Error('No connection to refresh');
    }

    setIsLoading(true);
    setError(null);

    try {
      await refreshConnectionData(connection);
    } catch (refreshError) {
      console.error('Error refreshing connection:', refreshError);
      setError('Failed to refresh connection');
      throw refreshError;
    } finally {
      setIsLoading(false);
    }
  }, [connection, refreshConnectionData]);

  const testConnection = useCallback(async (): Promise<boolean> => {
    if (!connection) {
      return false;
    }

    try {
      if (!connection.token) {
        const response = await fetch('/api/github-user');
        return response.ok;
      }

      const response = await fetch('https://api.github.com/user', {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          Authorization: getAuthorizationHeader(connection.token, connection.tokenType),
          'User-Agent': 'Bolt.diy',
        },
      });

      return response.ok;
    } catch (testError) {
      console.error('Connection test failed:', testError);
      return false;
    }
  }, [connection]);

  return {
    isConnected: !!connection?.user,
    isLoading,
    isConnecting: connecting,
    connection,
    error,
    isServerSide: !!connection?.user && !connection?.token,
    deviceFlow,
    connect,
    startWebOAuth,
    startDeviceFlow,
    cancelDeviceFlow,
    disconnect,
    refreshConnection,
    testConnection,
  };
}
