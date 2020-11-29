import React from 'react'
import {styled} from '../styles/theme'
import {Link} from 'gatsby'

const StyledNav = styled.nav`
  ul {
    list-style-type: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: inline-block;
    margin: 16px;

    a {
      background: none;
    }
  }
`

const Navigation: React.FC = () => (
  <StyledNav className="navigation">
    <ul>
      <li>
        <Link to={`/`}>&</Link>
      </li>
      <li>
        <Link to={`/tags`}>Tags</Link>
      </li>
      <li>
        <Link to={`/about`}>About</Link>
      </li>
    </ul>
  </StyledNav>
)

export default Navigation
