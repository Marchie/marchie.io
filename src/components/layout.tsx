import React from 'react'
import {GlobalStyle} from '../styles/theme'
import Footer from './footer'
import Navigation from './navigation'

interface Props {
  readonly title?: string
  readonly children: React.ReactNode
}

const Layout: React.FC<Props> = ({children}) => (
  <>
    <GlobalStyle />
    <Navigation />
    <main className="content" role="main">
      {children}
    </main>
    <Footer />
  </>
)

export default Layout
