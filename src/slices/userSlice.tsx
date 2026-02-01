import { createSlice } from '@reduxjs/toolkit'
import { useSelector } from 'react-redux';
import { RootState } from '../types';

const initialState = {
  "username": "Player"  // Removed token field
};

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    userSetUsername(state, action) {
      state.username = action.payload
    },
    userReset() {
      return initialState
    }
  }
})

export const userSelect = () => {
  return useSelector((state: RootState) => state.user)
}

export const { userSetUsername, userReset } = userSlice.actions
export default userSlice.reducer